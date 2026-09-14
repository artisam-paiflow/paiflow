import "server-only";
import {
  Address,
  FeeBumpTransaction,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { stellarPassphrase } from "@/lib/env";
import { log } from "@/lib/log";
import type { PipelineSnapshotNode } from "@/lib/flows/pipeline-snapshot";
import { sorobanRpc } from "@/lib/stellar/client";
import { pollEventsFor } from "@/lib/stellar/events";
import { buildPipelineErrorHint } from "@/lib/stellar/pipeline-error-hint";
import { translateSorobanError } from "@/lib/stellar/soroban-errors";

export const ONLY_SWAPPER_FLOWS =
  "Only swapper flows can be executed through the v1 API in this release";

export type SwapperPipeline = {
  nodes: PipelineSnapshotNode[];
  /** The deposit trigger at the head of the pipeline: the only contract execute may invoke. */
  triggerAddress: string;
};

/**
 * Resolve the pipeline a v1 execute runs through, from the deployment's
 * `pipelineSnapshot` rather than its graph (CLAUDE.md §2).
 *
 * The SOW scopes `/api/v1` to the swapper, and this check is what keeps that
 * true: the head must be a deposit trigger and a swapper must be downstream.
 * The swapper itself is never invoked directly — its `execute_step` requires
 * the parent's auth — so "execute" means depositing into the flow's trigger.
 */
export function resolveSwapperPipeline(
  deployment: Pick<Deployment, "status" | "pipelineSnapshot">,
): SwapperPipeline {
  if (deployment.status !== "CONFIRMED") {
    throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
  }
  const nodes = Array.isArray(deployment.pipelineSnapshot)
    ? (deployment.pipelineSnapshot as unknown as PipelineSnapshotNode[])
    : [];
  const head = nodes[0];
  if (
    head?.templateKind !== "DEPOSIT_TRIGGER" ||
    !head.contractAddress ||
    !nodes.some((n) => n.templateKind === "SWAPPER")
  ) {
    throw new AppError("VALIDATION", ONLY_SWAPPER_FLOWS);
  }
  return { nodes, triggerAddress: head.contractAddress };
}

/**
 * Parse a signed envelope and refuse anything but one `deposit` invocation on
 * this deployment's trigger contract.
 *
 * Without this a token for deployment A could relay any transaction it holds a
 * signature for and have it recorded under A's audit trail (CLAUDE.md §7.3).
 * Parsing with this environment's passphrase also pins the network: the hash
 * the caller signed over only matches if they signed for the same one.
 */
export function assertDepositEnvelope(signedXdr: string, triggerAddress: string): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(signedXdr, stellarPassphrase());
  } catch {
    throw new AppError("VALIDATION", "signedXdr is not a valid transaction envelope");
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new AppError(
      "VALIDATION",
      "Fee-bump envelopes are not accepted; submit the envelope prepare returned, signed",
    );
  }
  if (parsed.operations.length !== 1) {
    throw new AppError("VALIDATION", "The envelope must contain exactly one operation");
  }
  const op = parsed.operations[0]!;
  if (op.type !== "invokeHostFunction") {
    throw new AppError("VALIDATION", "The envelope's operation must invoke a contract");
  }
  if (op.func.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw new AppError("VALIDATION", "The envelope's operation must invoke a contract");
  }
  const call = op.func.invokeContract();
  let contract: string;
  try {
    contract = Address.fromScAddress(call.contractAddress()).toString();
  } catch {
    throw new AppError("VALIDATION", "The envelope does not invoke this flow's trigger contract");
  }
  if (contract !== triggerAddress) {
    throw new AppError("VALIDATION", "The envelope does not invoke this flow's trigger contract");
  }
  if (call.functionName().toString() !== "deposit") {
    throw new AppError("VALIDATION", "The envelope must call deposit on this flow's trigger");
  }
  return parsed;
}

/** The transaction's `maxTime` — prepare sets `setTimeout(180)` (CLAUDE.md §7.2). */
export function envelopeExpiresAt(unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, stellarPassphrase());
  const max = Number((tx as Transaction).timeBounds?.maxTime ?? 0);
  if (!max) throw new AppError("INTERNAL", "Prepared transaction has no expiry");
  return new Date(max * 1000).toISOString();
}

// The SDK sets no HTTP timeout, so the route owns its budget: under a typical
// 30 s proxy limit, with room left for the bounded ingest below.
export const CONFIRM_DEADLINE_MS = 25_000;
export const CONFIRM_POLL_INTERVAL_MS = 1_500;
// Best-effort, as in `tx-status`: the cron poller re-runs whatever this cuts short.
export const EVENT_INGEST_DEADLINE_MS = 5_000;

/**
 * Poll `getTransaction` until the transaction is final or the deadline passes.
 * Returns the last response, which is `NOT_FOUND` when time ran out.
 */
export async function waitForFinal(
  txHash: string,
  opts: { deadlineMs?: number; intervalMs?: number } = {},
): Promise<rpc.Api.GetTransactionResponse> {
  const server = sorobanRpc();
  const deadline = Date.now() + (opts.deadlineMs ?? CONFIRM_DEADLINE_MS);
  const interval = opts.intervalMs ?? CONFIRM_POLL_INTERVAL_MS;
  for (;;) {
    const got = await server.getTransaction(txHash);
    if (got.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return got;
    if (Date.now() + interval >= deadline) return got;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Pull the deployment's new contract events into the store so the events
 * endpoint shows the swap as soon as submit returns, without waiting longer
 * than `EVENT_INGEST_DEADLINE_MS` for it.
 */
export async function ingestEventsBounded(deploymentId: string, txHash: string): Promise<void> {
  const ingested = pollEventsFor(deploymentId).then(
    () => undefined,
    // Caught on the poll itself, so a rejection after the deadline is handled too.
    (err: unknown) => {
      log.warn({ err, deploymentId, txHash }, "v1 execute: event ingestion failed");
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    ingested,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log.warn({ deploymentId, txHash }, "v1 execute: event ingestion deadline hit");
        resolve();
      }, EVENT_INGEST_DEADLINE_MS);
    }),
  ]);
  clearTimeout(timer);
}

export type ExecuteFailure = { code: string; message: string };

const RESULT_MESSAGES: Record<string, string> = {
  txTooLate:
    "The transaction's 180-second window expired before it reached the network. Prepare it again.",
  txTooEarly: "The transaction is not valid yet. Prepare it again.",
  txBadSeq:
    "The `from` account's sequence number moved since this envelope was prepared. Prepare it again.",
  txBadAuth: "The envelope is not signed by the `from` account.",
  txInsufficientBalance: "The `from` account cannot cover the fee for this transaction.",
  txInsufficientFee: "The network fee rose above the one this envelope carries. Prepare it again.",
  txNoAccount: "The `from` account does not exist on this network.",
  txSorobanInvalid:
    "The network rejected the transaction's resource declaration. Prepare it again.",
};

const GENERIC_FAILURE =
  "The network rejected this transaction. Prepare the deposit again; if it keeps failing, check " +
  "that `from` is funded and the payout recipient holds a trustline for the output asset.";

/**
 * Render diagnostic events in the text shape `translateSorobanError` reads from
 * a simulation dump (`contract:C…, topics:[error, Error(Contract, #N)]`),
 * newest first as that dump is. The RPC returns them in emission order, and
 * the originating frame is emitted first, so the array is reversed.
 */
function renderDiagnostics(events: xdr.DiagnosticEvent[]): string {
  const lines: string[] = [];
  for (const d of [...events].reverse()) {
    const ev = d.event();
    const id = ev.contractId();
    if (!id) continue;
    const topics = ev.body().v0().topics();
    const err = topics[1];
    if (topics[0]?.switch().name !== "scvSymbol" || topics[0].sym().toString() !== "error") {
      continue;
    }
    if (err?.switch().name !== "scvError" || err.error().switch().name !== "sceContract") continue;
    const contract = StrKey.encodeContract(Buffer.from(id as unknown as Uint8Array));
    lines.push(
      `contract:${contract}, topics:[error, Error(Contract, #${err.error().contractCode()})]`,
    );
  }
  return lines.join("\n");
}

/**
 * Turn a rejected or reverted transaction into a message a partner can act on.
 * The pipeline hint costs RPC calls for a swapper (the Soroswap factory
 * lookup), so it is built here, on the failure path only (#436).
 */
export async function explainFailedTx(
  failure: { resultXdr?: xdr.TransactionResult; diagnosticEventsXdr?: xdr.DiagnosticEvent[] },
  nodes: PipelineSnapshotNode[],
): Promise<ExecuteFailure> {
  const rendered = renderDiagnostics(failure.diagnosticEventsXdr ?? []);
  if (rendered) {
    const t = translateSorobanError(rendered, await buildPipelineErrorHint(nodes));
    if (t.matched) return { code: t.errorName ?? "CONTRACT_ERROR", message: t.friendly };
  }

  const result = failure.resultXdr?.result().switch().name;
  if (result && RESULT_MESSAGES[result]) return { code: result, message: RESULT_MESSAGES[result] };
  return { code: result ?? "FAILED", message: GENERIC_FAILURE };
}
