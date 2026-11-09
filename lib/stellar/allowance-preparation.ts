import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Account, type rpc } from "@stellar/stellar-sdk";
import { log } from "@/lib/log";
import { interactiveRpcBudgetExpired, remainingInteractiveRpcMs } from "./interactive-rpc-budget";
import { loadPaymentAccount } from "./load-payment-account";

type AccountSnapshot = Readonly<{ address: string; sequence: string }>;
type Preparation = {
  readonly requestId: string;
  readonly accounts: WeakMap<object, Map<string, Promise<AccountSnapshot>>>;
};
const context = new AsyncLocalStorage<Preparation>();

type Phase =
  | "total"
  | "state"
  | "allowance"
  | "ledger"
  | "relayer-account"
  | "subscriber-account"
  | "approval-simulation"
  | "approval-assembly";

export const allowancePreparationRequestId = () => context.getStore()?.requestId;

/** Observational only: preserve the caller's result/error and shared RPC deadline. */
export async function observeAllowancePhase<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
  const preparation = context.getStore();
  if (!preparation) return work();
  const startedAt = Date.now();
  const fields = () => ({
    requestId: preparation.requestId,
    phase,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    remainingRpcMs: Number.isFinite(remainingInteractiveRpcMs())
      ? remainingInteractiveRpcMs()
      : null,
  });
  try {
    const result = await work();
    log.info({ ...fields(), outcome: "success" }, "Allowance preparation phase completed");
    return result;
  } catch (error) {
    // Never include arbitrary upstream errors, addresses, envelopes or request bodies.
    log.warn(
      {
        ...fields(),
        outcome: "failure",
        category: interactiveRpcBudgetExpired() ? "deadline" : "unavailable",
      },
      "Allowance preparation phase failed",
    );
    throw error;
  }
}

/** Only the public allowance POST opts in. Never reuse across requests or retries. */
export function withAllowancePreparation<T>(work: () => Promise<T>): Promise<T> {
  return context.run({ requestId: randomUUID(), accounts: new WeakMap() }, () =>
    observeAllowancePhase("total", work),
  );
}

/** Share one validated read-only source snapshot, including an in-flight failure.
 * Builders mutate Account, so every simulation receives a separate instance.
 * Approval builders use loadPaymentAccount directly and always load fresh state.
 */
export async function loadAllowanceReadAccount(
  server: Pick<rpc.Server, "_getLedgerEntries">,
  address: string,
): Promise<Account> {
  const preparation = context.getStore();
  if (!preparation) return loadPaymentAccount(server, address);
  let accounts = preparation.accounts.get(server);
  if (!accounts) {
    accounts = new Map();
    preparation.accounts.set(server, accounts);
  }
  let snapshot = accounts.get(address);
  if (!snapshot) {
    snapshot = observeAllowancePhase("relayer-account", async () => {
      const account = await loadPaymentAccount(server, address);
      return { address: account.accountId(), sequence: account.sequenceNumber() };
    });
    accounts.set(address, snapshot);
  }
  const account = await snapshot;
  return new Account(account.address, account.sequence);
}
