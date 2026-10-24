import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withDeploymentWork } from "@/lib/deployments/service-work";
import { sorobanRpc } from "@/lib/stellar/client";
import { interactiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { reconcileServiceTransactions } from "@/lib/stellar/reconcile-service-transactions";

// Keep the production RPC wrapper and durable observer. Replace only the SDK's
// parsed network result, so its implicit observation also exercises admission.
const read = vi.spyOn(rpc.Server.prototype, "getTransaction");
const response = (status: "SUCCESS" | "FAILED" | "NOT_FOUND", ledger = 123) =>
  ({ status, ...(status === "NOT_FOUND" ? {} : { ledger }) }) as rpc.Api.GetTransactionResponse;
const users: string[] = [];
const deployments: string[] = [];
// Other Vitest workers share the scratch database but provide different mocked
// chain evidence. Limit this file's discovery to its fixtures so a synthetic
// SUCCESS here cannot settle another file's deliberately unknown transaction.
// Keep the worker's real lifecycle/due predicates, ordering and LIMIT unchanged.
const findMany = db.serviceTransaction.findMany.bind(db.serviceTransaction);
vi.spyOn(db.serviceTransaction, "findMany").mockImplementation(((
  args: Prisma.ServiceTransactionFindManyArgs = {},
) =>
  findMany({
    ...args,
    where: { AND: [args.where ?? {}, { work: { deploymentId: { in: deployments } } }] },
  })) as typeof db.serviceTransaction.findMany);
const hash = () => randomBytes(32).toString("hex");

async function fixture(network = "testnet") {
  const user = await db.user.create({
    data: { username: `finality-${randomUUID()}`, passwordHash: "unused" },
  });
  users.push(user.id);
  const flow = await db.flow.create({
    data: {
      ownerId: user.id,
      name: "Funding finality",
      templateKind: "STREAMER",
      graph: {},
      parameters: {},
    },
  });
  const deployment = await db.deployment.create({
    data: {
      ownerId: user.id,
      flowId: flow.id,
      network,
      status: "CONFIRMED",
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  });
  deployments.push(deployment.id);
  return deployment;
}
async function pending(
  deploymentId: string,
  txHash = hash(),
  transport = "rpc",
  state: "DONE" | "OPEN" | "BLOCKED" = "DONE",
) {
  const work = await db.deploymentWork.create({
    data: { deploymentId, kind: "funding-submit", state },
  });
  return db.serviceTransaction.create({ data: { workId: work.id, txHash, transport } });
}
async function due(id: string) {
  await db.serviceTransaction.update({ where: { id }, data: { nextCheckAt: new Date(0) } });
}
async function stored(id: string) {
  return db.serviceTransaction.findUniqueOrThrow({ where: { id } });
}
async function signed(
  deploymentId: string,
  txHash: string,
  outcome: "CONFIRMED" | "FAILED" | "REJECTED",
  failureCode?: string,
  network = "testnet",
  ledger: number | null = 123,
) {
  return db.signedTransaction.create({
    data: {
      txHash,
      signerAddress: "G-unused",
      kind: "TRIGGER",
      network,
      deploymentId,
      outcome,
      ledger,
      failureCode,
    },
  });
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(response("NOT_FOUND"));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  // The bound mock survives in the SDK wrapper; reset it, rather than swapping
  // clients whose process-owned context production intentionally retains.
  read.mockReset();
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.serviceTransaction.deleteMany({
    where: { work: { deploymentId: { in: deployments } } },
  });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  await db.flow.deleteMany({ where: { ownerId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  users.length = 0;
  deployments.length = 0;
});

describe("background service finality projection", () => {
  it.each(["SUCCESS", "FAILED"] as const)(
    "projects original-hash %s after browser departure and preserves DONE work",
    async (state) => {
      const d = await fixture();
      const row = await pending(d.id);
      read.mockResolvedValue(response(state));
      expect(await reconcileServiceTransactions()).toMatchObject({
        checked: 1,
        [state === "SUCCESS" ? "confirmed" : "failed"]: 1,
      });
      expect(await stored(row.id)).toMatchObject({ txHash: row.txHash, state, ledger: 123 });
      expect(
        await db.deploymentWork.findUniqueOrThrow({ where: { id: row.workId } }),
      ).toMatchObject({ state: "DONE" });
      expect(await reconcileServiceTransactions()).toMatchObject({ checked: 0 });
      expect(read).toHaveBeenCalledExactlyOnceWith(row.txHash);
    },
  );

  it.each(["CONFIRMED", "FAILED"] as const)(
    "repairs existing %s signed rows without needing retained RPC history",
    async (outcome) => {
      const d = await fixture();
      const row = await pending(d.id);
      await signed(d.id, row.txHash, outcome, outcome === "FAILED" ? "ONCHAIN_FAILED" : undefined);
      await reconcileServiceTransactions();
      expect(await stored(row.id)).toMatchObject({
        state: outcome === "CONFIRMED" ? "SUCCESS" : "FAILED",
        ledger: 123,
      });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    { outcome: "REJECTED", failureCode: "CONTROL_EXPIRED", ledger: 123, network: "testnet" },
    { outcome: "FAILED", failureCode: "RPC_UNAVAILABLE", ledger: 123, network: "testnet" },
    { outcome: "CONFIRMED", ledger: null, network: "testnet" },
    { outcome: "CONFIRMED", ledger: 123, network: "mainnet" },
  ] as const)("does not project insufficient durable proof: %j", async (proof) => {
    const d = await fixture();
    const row = await pending(d.id);
    await signed(
      d.id,
      row.txHash,
      proof.outcome,
      "failureCode" in proof ? proof.failureCode : undefined,
      proof.network,
      proof.ledger,
    );
    expect(await reconcileServiceTransactions()).toMatchObject({ unresolved: 1 });
    expect((await stored(row.id)).state).toBe("PENDING");
  });

  it("shares a read across admitted participants without updating retired or other-network rows", async () => {
    const a = await fixture();
    const b = await fixture();
    const retired = await fixture();
    const mainnet = await fixture("mainnet");
    const txHash = hash();
    const first = await pending(a.id, txHash);
    const second = await pending(b.id, txHash);
    const excluded = [await pending(retired.id, txHash), await pending(mainnet.id, txHash)];
    await db.deployment.update({
      where: { id: retired.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    await db.deployment.update({
      where: { id: retired.id },
      data: { serviceState: "RETIRED", retiredAt: new Date(), retirementReconciledAt: new Date() },
    });
    read.mockResolvedValue(response("SUCCESS"));
    expect(await reconcileServiceTransactions()).toMatchObject({ checked: 2, confirmed: 2 });
    expect(read).toHaveBeenCalledTimes(1);
    expect((await stored(first.id)).state).toBe("SUCCESS");
    expect((await stored(second.id)).state).toBe("SUCCESS");
    for (const row of excluded) expect((await stored(row.id)).state).toBe("PENDING");
  });

  it("rotates unknown old hashes behind fresh work and recovers on a later tick", async () => {
    const d = await fixture();
    const old = await pending(d.id);
    await db.serviceTransaction.update({
      where: { id: old.id },
      data: { createdAt: new Date(0), nextCheckAt: new Date(0) },
    });
    expect(await reconcileServiceTransactions({ batch: 1 })).toMatchObject({
      checked: 1,
      unresolved: 1,
    });
    expect(await stored(old.id)).toMatchObject({
      state: "PENDING",
      checkAttempts: 1,
      ledger: null,
    });
    const fresh = await pending(d.id);
    read.mockResolvedValue(response("SUCCESS"));
    await reconcileServiceTransactions({ batch: 1 });
    expect((await stored(fresh.id)).state).toBe("SUCCESS");
    await due(old.id);
    await reconcileServiceTransactions({ batch: 1 });
    expect((await stored(old.id)).state).toBe("SUCCESS");
  });

  it("keeps fresh retries within one minute and bounds old unknown retries without clearing them", async () => {
    const d = await fixture();
    const recent = await pending(d.id);
    const old = await pending(d.id);
    await db.serviceTransaction.update({ where: { id: recent.id }, data: { checkAttempts: 20 } });
    await db.serviceTransaction.update({
      where: { id: old.id },
      data: { checkAttempts: 20, createdAt: new Date(0) },
    });
    const started = Date.now();
    await reconcileServiceTransactions();
    expect((await stored(recent.id)).nextCheckAt.getTime() - started).toBeLessThan(61_000);
    expect((await stored(old.id)).nextCheckAt.getTime() - started).toBeGreaterThanOrEqual(900_000);
    expect((await stored(old.id)).state).toBe("PENDING");
  });

  it("does not terminalize malformed SDK finality without a positive ledger", async () => {
    const d = await fixture();
    const row = await pending(d.id);
    read.mockResolvedValue(response("SUCCESS", 0));
    expect(await reconcileServiceTransactions()).toMatchObject({ unresolved: 1 });
    expect(await stored(row.id)).toMatchObject({ state: "PENDING", ledger: null });
  });

  it("retains unknown finality across unavailable providers, then recovers the original hash", async () => {
    const d = await fixture();
    const row = await pending(d.id);
    read.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect(await reconcileServiceTransactions()).toMatchObject({ unresolved: 1 });
    expect((await stored(row.id)).state).toBe("PENDING");
    await due(row.id);
    read.mockResolvedValue(response("SUCCESS"));
    await reconcileServiceTransactions();
    expect(await stored(row.id)).toMatchObject({ state: "SUCCESS", txHash: row.txHash });
  });

  it.each([true, false])(
    "uses the original Horizon transaction with successful=%s",
    async (successful) => {
      const d = await fixture();
      const row = await pending(d.id, hash(), "horizon");
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              successful,
              ledger: 321,
              _links: { ledger: { href: "https://horizon.invalid/ledgers/321" } },
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal("fetch", fetch);
      await reconcileServiceTransactions();
      expect(await stored(row.id)).toMatchObject({
        state: successful ? "SUCCESS" : "FAILED",
        ledger: 321,
      });
      expect(String(fetch.mock.calls[0]?.[0])).toContain(`/transactions/${row.txHash}`);
    },
  );

  it("keeps Horizon absence pending and retries without a replacement send", async () => {
    const d = await fixture();
    const row = await pending(d.id, hash(), "horizon");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify({ title: "Not Found", status: 404 }), { status: 404 }),
      ),
    );
    expect(await reconcileServiceTransactions()).toMatchObject({ unresolved: 1 });
    expect((await stored(row.id)).state).toBe("PENDING");
  });

  it("excludes retiring rows before the batch limit and retains crashed OPEN work", async () => {
    const retiring = await fixture();
    const active = await fixture();
    const excluded = await pending(retiring.id);
    await due(excluded.id);
    await db.deployment.update({
      where: { id: retiring.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    const row = await pending(active.id, hash(), "rpc", "OPEN");
    read.mockResolvedValue(response("SUCCESS"));
    expect(await reconcileServiceTransactions({ batch: 1 })).toMatchObject({
      checked: 1,
      confirmed: 1,
    });
    expect((await stored(excluded.id)).checkAttempts).toBe(0);
    expect(await db.deploymentWork.findUniqueOrThrow({ where: { id: row.workId } })).toMatchObject({
      state: "OPEN",
    });
  });

  it("rechecks admission when a loaded deployment starts retiring before its turn", async () => {
    const a = await fixture();
    const b = await fixture();
    const first = await pending(a.id);
    await due(first.id);
    const second = await pending(b.id);
    read.mockImplementation(async () => {
      await db.deployment.update({
        where: { id: b.id },
        data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
      });
      return response("SUCCESS");
    });
    expect(await reconcileServiceTransactions()).toMatchObject({ checked: 1, confirmed: 1 });
    expect((await stored(second.id)).checkAttempts).toBe(0);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("caps a hung provider read at the remaining tick budget", async () => {
    const d = await fixture();
    const row = await pending(d.id);
    read.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          interactiveRpcBudget()!.signal.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          );
        }),
    );
    const started = Date.now();
    expect(await reconcileServiceTransactions({ budgetMs: 100 })).toMatchObject({
      checked: 1,
      unresolved: 1,
    });
    expect(Date.now() - started).toBeLessThan(1500);
    expect((await stored(row.id)).state).toBe("PENDING");
  });

  it("preserves owner original-hash observation of historical work within an admitted request", async () => {
    const d = await fixture();
    const row = await pending(d.id);
    read.mockResolvedValue(response("SUCCESS"));
    await withDeploymentWork(d.id, "owner-tx-status", () =>
      sorobanRpc().getTransaction(row.txHash),
    );
    expect(await stored(row.id)).toMatchObject({ state: "SUCCESS", ledger: 123 });
  });
});
