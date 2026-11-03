import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TRACKING_VERSION } from "@/lib/analytics/policy";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { reconcileControlIntent, recordControlFinality } from "@/lib/api/v1/control-intent";
import { getTransactionStatus } from "@/lib/api/v1/transaction-status";
import { projectControlFinality } from "@/lib/deployments/control-finality";
import { withDeploymentWork } from "@/lib/deployments/service-work";
import { sorobanRpc } from "@/lib/stellar/client";
import { reconcileTransactions } from "@/lib/stellar/reconcile-transactions";
import { reconcileControlIntents } from "@/lib/stellar/reconcile-control-intents";
import { reconcileServiceTransactions } from "@/lib/stellar/reconcile-service-transactions";

const read = vi.spyOn(rpc.Server.prototype, "getTransaction");
const owner = Keypair.random().publicKey();
const deployments: string[] = [];
const users: string[] = [];
const hash = () => randomBytes(32).toString("hex");

// Scope only fixture ownership while preserving production proof/lifecycle/due
// predicates and applying this additional filter BEFORE ordering and LIMIT.
const queryRaw = db.$queryRaw.bind(db);
vi.spyOn(db, "$queryRaw").mockImplementation((async (
  query: TemplateStringsArray | Prisma.Sql,
  ...values: unknown[]
) => {
  if (Array.isArray(query) && query[0]?.includes('SELECT i."id"')) {
    const pieces = [...query];
    pieces[0] = pieces[0]!.replace('WHERE i."network" = ', 'WHERE i."deploymentId" = ANY(');
    pieces.splice(1, 0, '::uuid[]) AND i."network" = ');
    return queryRaw(Prisma.sql(pieces, deployments, ...values));
  }
  return queryRaw(query, ...values);
}) as typeof db.$queryRaw);
const findSigned = db.signedTransaction.findMany.bind(db.signedTransaction);
vi.spyOn(db.signedTransaction, "findMany").mockImplementation(((
  args: Prisma.SignedTransactionFindManyArgs = {},
) =>
  findSigned({
    ...args,
    where: { AND: [args.where ?? {}, { deploymentId: { in: deployments } }] },
  })) as typeof db.signedTransaction.findMany);
const findServices = db.serviceTransaction.findMany.bind(db.serviceTransaction);
vi.spyOn(db.serviceTransaction, "findMany").mockImplementation(((
  args: Prisma.ServiceTransactionFindManyArgs = {},
) =>
  findServices({
    ...args,
    where: { AND: [args.where ?? {}, { work: { deploymentId: { in: deployments } } }] },
  })) as typeof db.serviceTransaction.findMany);

async function fixture(
  options: {
    serviceState?: "ACTIVE" | "RETIRING" | "RETIRED";
    network?: string;
    state?: "PREPARED" | "SUBMITTING" | "SUCCESS" | "FAILED" | "EXPIRED";
    action?: string;
    outcome?: "RECEIVED" | "ACCEPTED" | "CONFIRMED" | "FAILED" | "REJECTED" | "UNRESOLVED";
    ledger?: number | null;
    failureCode?: string;
    workState?: "OPEN" | "DONE" | "BLOCKED";
  } = {},
) {
  const user = await db.user.create({
    data: {
      username: `intent-finality-${randomUUID()}`,
      passwordHash: "local-test-only",
    },
  });
  users.push(user.id);
  const flow = await db.flow.create({
    data: {
      ownerId: user.id,
      name: "Intent finality",
      templateKind: "PAYER",
      graph: {},
      parameters: {},
    },
  });
  const deployment = await db.deployment.create({
    data: {
      ownerId: user.id,
      flowId: flow.id,
      network: options.network ?? "testnet",
      status: "CONFIRMED",
      serviceState: options.serviceState ?? "ACTIVE",
      ...(options.serviceState && options.serviceState !== "ACTIVE"
        ? { retirementRequestedAt: new Date() }
        : {}),
      ...(options.serviceState === "RETIRED"
        ? { retiredAt: new Date(), retirementReconciledAt: new Date() }
        : {}),
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  });
  deployments.push(deployment.id);
  const txHash = hash();
  const action = options.action ?? "payment.execute";
  const intent = await db.walletControlIntent.create({
    data: {
      deploymentId: deployment.id,
      network: deployment.network,
      nodeId: "root",
      contractAddress: "C-test",
      walletAddress: owner,
      action,
      txHash,
      maxTime: "1",
      preparationLedger: 1,
      hostedAccessHash: "retained-hosted-capability-digest",
      idempotencyKeyHash: "original-key",
      requestDigest: "original-request",
      state: options.state ?? "SUBMITTING",
      finalityNextCheckAt: new Date(0),
      ...(["SUCCESS", "FAILED"].includes(options.state ?? "")
        ? { ledger: 123, completedAt: new Date() }
        : {}),
    },
  });
  const signed = await db.signedTransaction.create({
    data: {
      txHash,
      signerAddress: owner,
      kind: action === "payment.execute" ? "API_EXECUTE" : "INVOKE",
      network: deployment.network,
      deploymentId: deployment.id,
      trackingVersion: TRACKING_VERSION,
      outcome: options.outcome ?? "CONFIRMED",
      ledger: options.ledger === undefined ? 123 : options.ledger,
      failureCode: options.failureCode,
      nextCheckAt: new Date(0),
    },
  });
  const work = await db.deploymentWork.create({
    data: {
      deploymentId: deployment.id,
      kind: "original-submission",
      state: options.workState ?? "DONE",
      ...(options.workState === "BLOCKED" ? { blocker: "Retain opaque work evidence" } : {}),
    },
  });
  const service = await db.serviceTransaction.create({
    data: { workId: work.id, txHash, transport: "rpc" },
  });
  return { deployment, intent, signed, work, service };
}

beforeEach(() => {
  read.mockRejectedValue(new Error("RPC history unavailable"));
});
afterEach(async () => {
  vi.clearAllMocks();
  await db.serviceTransaction.deleteMany({
    where: { work: { deploymentId: { in: deployments } } },
  });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.walletControlIntent.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.signedTransaction.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  await db.flow.deleteMany({ where: { ownerId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  deployments.length = 0;
  users.length = 0;
});
const stored = (id: string) => db.walletControlIntent.findUniqueOrThrow({ where: { id } });

describe("automatic wallet-intent convergence with real PostgreSQL", () => {
  it.each(["SUCCESS", "FAILED"] as const)(
    "recovers service-only %s after interruption immediately following the real RPC wrapper",
    async (state) => {
      const f = await fixture({ outcome: "ACCEPTED", ledger: null, workState: "OPEN" });
      read.mockResolvedValue({ status: state, ledger: 123 } as rpc.Api.GetTransactionResponse);
      await expect(
        withDeploymentWork(f.deployment.id, "interrupted-control-recovery", async () => {
          await sorobanRpc().getTransaction(f.intent.txHash);
          throw new Error("interrupted before intent projection");
        }),
      ).rejects.toThrow("interrupted before intent projection");
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } }),
      ).toMatchObject({ outcome: "ACCEPTED", ledger: null });
      expect(
        await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } }),
      ).toMatchObject({ state, ledger: 123 });
      read.mockClear();
      read.mockRejectedValue(new Error("RPC history expired"));
      expect(await reconcileControlIntents()).toMatchObject({ repaired: 1, failed: 0 });
      expect(await stored(f.intent.id)).toMatchObject({
        state,
        ledger: 123,
        txHash: f.intent.txHash,
      });
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } }),
      ).toMatchObject({
        outcome: state === "SUCCESS" ? "CONFIRMED" : "FAILED",
        ledger: 123,
        failureCode: state === "FAILED" ? "ONCHAIN_FAILED" : null,
      });
      expect((await db.deploymentWork.findUniqueOrThrow({ where: { id: f.work.id } })).state).toBe(
        "OPEN",
      );
      expect(read).not.toHaveBeenCalled();
      expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    },
  );

  it("recovers service-worker-first finality on the next automatic repair pass without RPC", async () => {
    const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
    await db.serviceTransaction.update({
      where: { id: f.service.id },
      data: { nextCheckAt: new Date(0) },
    });
    read.mockResolvedValue({ status: "SUCCESS", ledger: 123 } as rpc.Api.GetTransactionResponse);
    expect(await reconcileServiceTransactions()).toMatchObject({ confirmed: 1 });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } })).outcome,
    ).toBe("UNRESOLVED");
    read.mockClear();
    read.mockRejectedValue(new Error("RPC history expired"));
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 1, failed: 0 });
    expect((await stored(f.intent.id)).state).toBe("SUCCESS");
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["SUCCESS", "FAILED"] as const)(
    "explicit recovery consumes retained service-only %s before RPC",
    async (state) => {
      const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
      await db.serviceTransaction.update({
        where: { id: f.service.id },
        data: { state, ledger: 123 },
      });
      expect(
        await reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
      ).toMatchObject({ state, ledger: 123 });
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    { state: "REJECTED", ledger: 123 },
    { state: "PENDING", ledger: 123 },
    { state: "SUCCESS", ledger: null },
    { state: "FAILED", ledger: 0 },
    { state: "SUCCESS", ledger: 123, transport: "horizon" },
  ] satisfies Prisma.ServiceTransactionUpdateInput[])(
    "does not infer finality from an insufficient service receipt %j",
    async (receipt) => {
      const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
      await db.serviceTransaction.update({ where: { id: f.service.id }, data: receipt });
      expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
      await expect(
        reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
      ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    },
  );

  it.each([
    { signerAddress: Keypair.random().publicKey() },
    { network: "mainnet" },
    { signedBySource: false },
    { kind: "DEPLOY" },
  ] satisfies Prisma.SignedTransactionUpdateInput[])(
    "service-only proof still requires original signed attribution %j",
    async (change) => {
      const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
      await db.serviceTransaction.update({
        where: { id: f.service.id },
        data: { state: "SUCCESS", ledger: 123 },
      });
      await db.signedTransaction.update({ where: { id: f.signed.id }, data: change });
      expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
      await expect(
        reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
      ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    },
  );

  it("ignores service-only proof belonging to a different deployment", async () => {
    const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
    const other = await fixture({ outcome: "UNRESOLVED", ledger: null });
    await db.serviceTransaction.update({
      where: { id: other.service.id },
      data: { txHash: f.intent.txHash, state: "SUCCESS", ledger: 123 },
    });
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    await expect(
      reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
    ).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
  });

  it("retains reservations when service-only receipts contradict each other", async () => {
    const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
    await db.serviceTransaction.update({
      where: { id: f.service.id },
      data: { state: "SUCCESS", ledger: 123 },
    });
    const work = await db.deploymentWork.create({
      data: { deploymentId: f.deployment.id, kind: "conflicting-receipt", state: "DONE" },
    });
    await db.serviceTransaction.create({
      data: {
        workId: work.id,
        txHash: f.intent.txHash,
        transport: "rpc",
        state: "FAILED",
        ledger: 123,
      },
    });
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 0, failed: 1 });
    await expect(
      reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
  });

  it("repairs service-only finality without rewriting obsolete signed analytics", async () => {
    const f = await fixture({ outcome: "UNRESOLVED", ledger: null });
    await db.signedTransaction.update({
      where: { id: f.signed.id },
      data: { trackingVersion: "obsolete-policy" },
    });
    await db.serviceTransaction.update({
      where: { id: f.service.id },
      data: { state: "SUCCESS", ledger: 123 },
    });
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 1, failed: 0 });
    expect((await stored(f.intent.id)).state).toBe("SUCCESS");
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } })).outcome,
    ).toBe("UNRESOLVED");
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
  });

  it("ordinary signed reconciliation then one repair tick finalizes without a browser or status call", async () => {
    const f = await fixture({ outcome: "RECEIVED", ledger: null });
    read.mockResolvedValue({ status: "SUCCESS", ledger: 123 } as rpc.Api.GetTransactionResponse);
    expect(await reconcileTransactions()).toMatchObject({ confirmed: 1 });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    read.mockClear();
    read.mockRejectedValue(new Error("history gone"));
    expect(await reconcileControlIntents()).toMatchObject({ checked: 1, repaired: 1, failed: 0 });
    expect(await stored(f.intent.id)).toMatchObject({
      state: "SUCCESS",
      ledger: 123,
      txHash: f.intent.txHash,
      idempotencyKeyHash: "original-key",
      requestDigest: "original-request",
      hostedAccessHash: "retained-hosted-capability-digest",
    });
    expect(
      await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } }),
    ).toMatchObject({ state: "SUCCESS", ledger: 123 });
    expect(read).not.toHaveBeenCalled();
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
  });

  it.each(["OPEN", "BLOCKED"] as const)(
    "settles retained signed proof without clearing original %s work",
    async (workState) => {
      const f = await fixture({ workState });
      await db.signedTransaction.update({
        where: { id: f.signed.id },
        data: { trackingVersion: "older-policy" },
      });
      await reconcileControlIntents();
      expect((await stored(f.intent.id)).state).toBe("SUCCESS");
      expect(await db.deploymentWork.findUniqueOrThrow({ where: { id: f.work.id } })).toMatchObject(
        { state: workState, completedAt: null },
      );
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("projects authoritative on-chain failure for an admin mutation without treating queue rejection as failure", async () => {
    const f = await fixture({
      action: "configuration.mutate",
      outcome: "FAILED",
      failureCode: "ONCHAIN_FAILED",
    });
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 1 });
    expect(await stored(f.intent.id)).toMatchObject({ state: "FAILED", ledger: 123 });
    expect(
      await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } }),
    ).toMatchObject({ state: "FAILED", ledger: 123 });
  });

  it.each([
    { outcome: "FAILED", failureCode: "RPC_REJECTED" },
    { outcome: "REJECTED", failureCode: "RPC_REJECTED" },
    { outcome: "UNRESOLVED", failureCode: "FINALITY_UNKNOWN" },
    { outcome: "CONFIRMED", ledger: null },
    { outcome: "CONFIRMED", ledger: 0 },
  ] as const)("never releases an unknown or insufficient proof %j", async (proof) => {
    const f = await fixture(proof);
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { network: "mainnet" },
    { signerAddress: Keypair.random().publicKey() },
    { signedBySource: false },
    { isFeeBump: true },
    { kind: "DEPLOY" },
  ] satisfies Prisma.SignedTransactionUpdateInput[])(
    "refuses mismatched signed attribution %j",
    async (change) => {
      const f = await fixture();
      await db.signedTransaction.update({ where: { id: f.signed.id }, data: change });
      expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    },
  );

  it("filters unknown, wrong-network, RETIRING and RETIRED rows before LIMIT", async () => {
    const excluded = [
      await fixture({ outcome: "UNRESOLVED" }),
      await fixture({ network: "mainnet" }),
      await fixture({ serviceState: "RETIRING" }),
      await fixture({ serviceState: "RETIRED" }),
    ];
    const valid = await fixture();
    expect(await reconcileControlIntents({ batch: 1 })).toMatchObject({ repaired: 1 });
    expect((await stored(valid.intent.id)).state).toBe("SUCCESS");
    for (const f of excluded) expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
  });

  it("repairs terminal intents with incomplete service projection and leaves unrelated shared-hash participants untouched", async () => {
    const f = await fixture({ state: "SUCCESS" });
    const other = await fixture();
    await db.serviceTransaction.update({
      where: { id: other.service.id },
      data: { txHash: f.intent.txHash },
    });
    // Exclude the other fixture's own payment from this worker pass.
    await db.signedTransaction.update({
      where: { id: other.signed.id },
      data: { outcome: "UNRESOLVED" },
    });
    await reconcileControlIntents();
    expect(
      (await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } })).state,
    ).toBe("SUCCESS");
    expect(
      (await db.serviceTransaction.findUniqueOrThrow({ where: { id: other.service.id } })).state,
    ).toBe("PENDING");
  });

  it("rolls back intent finality if service projection fails, then retries without losing durable signed evidence", async () => {
    const f = await fixture();
    // Inject inside the transaction after the intent update, not before admission.
    await db.deploymentWork.update({
      where: { id: f.work.id },
      data: { kind: "1193-injected-projection-failure" },
    });
    await db.$executeRaw`CREATE FUNCTION fail_control_projection() RETURNS trigger AS $$ BEGIN IF EXISTS (SELECT 1 FROM "DeploymentWork" WHERE "id" = NEW."workId" AND "kind" = '1193-injected-projection-failure') THEN RAISE EXCEPTION 'injected projection failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await db.$executeRaw`CREATE TRIGGER fail_control_projection BEFORE UPDATE ON "ServiceTransaction" FOR EACH ROW EXECUTE FUNCTION fail_control_projection()`;
    try {
      expect(await reconcileControlIntents()).toMatchObject({ failed: 1, repaired: 0 });
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
      expect(
        (await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } })).outcome,
      ).toBe("CONFIRMED");
    } finally {
      await db.$executeRaw`DROP TRIGGER fail_control_projection ON "ServiceTransaction"`;
      await db.$executeRaw`DROP FUNCTION fail_control_projection()`;
    }
    await db.walletControlIntent.update({
      where: { id: f.intent.id },
      data: { finalityNextCheckAt: new Date(0) },
    });
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 1 });
  });

  it("concurrent explicit recovery and worker projection converge without RPC or changing completion identity", async () => {
    const f = await fixture();
    await Promise.all([
      reconcileControlIntents(),
      reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute"),
    ]);
    const first = await stored(f.intent.id);
    await recordControlFinality(f.deployment.id, f.intent.txHash, "SUCCESS", 123);
    expect((await stored(f.intent.id)).completedAt).toEqual(first.completedAt);
    expect(first.state).toBe("SUCCESS");
    expect(read).not.toHaveBeenCalled();
  });

  it("retiring settlement may consume durable proof while retired data remains untouched", async () => {
    const f = await fixture({ serviceState: "RETIRING" });
    expect(
      (await reconcileControlIntent(f.intent.id, f.deployment.id, "payment.execute")).state,
    ).toBe("SUCCESS");
    const retired = await fixture({ serviceState: "RETIRED" });
    await projectControlFinality(retired.deployment.id, retired.intent.txHash, {
      state: "SUCCESS",
      ledger: 123,
    });
    expect((await stored(retired.intent.id)).state).toBe("SUBMITTING");
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects contradictory signed or service finality without releasing the reservation", async () => {
    const f = await fixture();
    await expect(
      projectControlFinality(f.deployment.id, f.intent.txHash, { state: "FAILED", ledger: 123 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db.serviceTransaction.update({
      where: { id: f.service.id },
      data: { state: "FAILED", ledger: 123 },
    });
    await expect(
      projectControlFinality(f.deployment.id, f.intent.txHash, { state: "SUCCESS", ledger: 123 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
  });

  it("retains authoritative expiry and REJECTED service evidence rather than overwriting it", async () => {
    const expired = await fixture({ state: "EXPIRED" });
    await expect(
      projectControlFinality(expired.deployment.id, expired.intent.txHash, {
        state: "SUCCESS",
        ledger: 123,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const f = await fixture();
    await db.serviceTransaction.update({
      where: { id: f.service.id },
      data: { state: "REJECTED" },
    });
    await reconcileControlIntents();
    expect((await stored(f.intent.id)).state).toBe("SUCCESS");
    expect(
      (await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } })).state,
    ).toBe("REJECTED");
  });

  it("does not re-emit terminal signed analytics during automatic repair", async () => {
    const f = await fixture({ outcome: "RECEIVED", ledger: null });
    expect(await recordTransactionOutcome(f.intent.txHash, "CONFIRMED", { ledger: 123 })).toBe(
      true,
    );
    await reconcileControlIntents();
    expect(await recordTransactionOutcome(f.intent.txHash, "CONFIRMED", { ledger: 123 })).toBe(
      false,
    );
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } }))
        .outcomeRevision,
    ).toBe(1);
  });
  it("rotates a contradictory poison row behind the next due payment with batch one", async () => {
    const poison = await fixture();
    await db.serviceTransaction.update({
      where: { id: poison.service.id },
      data: { state: "FAILED", ledger: 123 },
    });
    await db.walletControlIntent.update({
      where: { id: poison.intent.id },
      data: { finalityNextCheckAt: new Date(0) },
    });
    const valid = await fixture();
    await db.walletControlIntent.update({
      where: { id: valid.intent.id },
      data: { finalityNextCheckAt: new Date(1) },
    });
    expect(await reconcileControlIntents({ batch: 1 })).toMatchObject({
      checked: 1,
      failed: 1,
      repaired: 0,
    });
    expect((await stored(poison.intent.id)).state).toBe("SUBMITTING");
    expect((await stored(poison.intent.id)).finalityNextCheckAt.getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(await reconcileControlIntents({ batch: 1 })).toMatchObject({ repaired: 1 });
    expect((await stored(valid.intent.id)).state).toBe("SUCCESS");
  });

  it("wrong-deployment proof does not release the original reservation through the sweep or status fallback", async () => {
    const f = await fixture();
    const other = await fixture({ outcome: "UNRESOLVED" });
    await db.signedTransaction.update({
      where: { id: f.signed.id },
      data: { deploymentId: other.deployment.id },
    });
    read.mockResolvedValue({ status: "NOT_FOUND" } as rpc.Api.GetTransactionResponse);
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    expect((await getTransactionStatus(f.deployment, f.intent.txHash)).status).toBe("UNKNOWN");
    expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
  });

  it.each([
    { outcome: "FAILED", failureCode: "RPC_REJECTED" },
    { outcome: "CONFIRMED", ledger: null },
  ] as const)(
    "status fallback cannot release a reservation from invalid retained proof %j",
    async (proof) => {
      const f = await fixture(proof);
      read.mockResolvedValue({ status: "NOT_FOUND" } as rpc.Api.GetTransactionResponse);
      expect((await getTransactionStatus(f.deployment, f.intent.txHash)).status).toBe("UNKNOWN");
      expect((await stored(f.intent.id)).state).toBe("SUBMITTING");
    },
  );
  it.each(["SUCCESS", "FAILED"] as const)(
    "repairs the reverse crash window from terminal %s intent proof",
    async (state) => {
      const f = await fixture({ state, outcome: "ACCEPTED", ledger: null });
      expect(await reconcileControlIntents()).toMatchObject({ repaired: 1, failed: 0 });
      expect(
        await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } }),
      ).toMatchObject({
        outcome: state === "SUCCESS" ? "CONFIRMED" : "FAILED",
        ledger: 123,
        failureCode: state === "FAILED" ? "ONCHAIN_FAILED" : null,
      });
      expect((await stored(f.intent.id)).completedAt).toEqual(f.intent.completedAt);
      expect(
        (await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } })).state,
      ).toBe(state);
      expect(read).not.toHaveBeenCalled();
      expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    },
  );

  it("retains reverse projection retry after outcome/outbox failure instead of treating a false recorder result as success", async () => {
    const f = await fixture({ state: "SUCCESS", outcome: "ACCEPTED", ledger: null });
    await db.walletControlIntent.update({
      where: { id: f.intent.id },
      data: { nodeId: "1193-injected-outcome-failure" },
    });
    await db.$executeRaw`CREATE FUNCTION fail_control_outcome() RETURNS trigger AS $$ BEGIN IF EXISTS (SELECT 1 FROM "WalletControlIntent" WHERE "txHash" = NEW."properties"->>'tx_hash' AND "nodeId" = '1193-injected-outcome-failure') THEN RAISE EXCEPTION 'injected outcome failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await db.$executeRaw`CREATE TRIGGER fail_control_outcome BEFORE INSERT ON "AnalyticsDelivery" FOR EACH ROW EXECUTE FUNCTION fail_control_outcome()`;
    try {
      expect(await reconcileControlIntents()).toMatchObject({ failed: 1, repaired: 0 });
      expect((await stored(f.intent.id)).state).toBe("SUCCESS");
      expect(
        (await db.serviceTransaction.findUniqueOrThrow({ where: { id: f.service.id } })).state,
      ).toBe("SUCCESS");
      expect(
        (await db.signedTransaction.findUniqueOrThrow({ where: { id: f.signed.id } })).outcome,
      ).toBe("ACCEPTED");
    } finally {
      await db.$executeRaw`DROP TRIGGER fail_control_outcome ON "AnalyticsDelivery"`;
      await db.$executeRaw`DROP FUNCTION fail_control_outcome()`;
    }
    await db.walletControlIntent.update({
      where: { id: f.intent.id },
      data: { finalityNextCheckAt: new Date(0) },
    });
    expect(await reconcileControlIntents()).toMatchObject({ repaired: 1 });
  });

  it("does not rewrite contradictory terminal intent/signed proof or obsolete nonterminal analytics policies", async () => {
    const contradictory = await fixture({
      state: "SUCCESS",
      outcome: "FAILED",
      failureCode: "ONCHAIN_FAILED",
    });
    await expect(
      projectControlFinality(contradictory.deployment.id, contradictory.intent.txHash, {
        state: "SUCCESS",
        ledger: 123,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const legacy = await fixture({ state: "SUCCESS", outcome: "UNRESOLVED", ledger: null });
    await db.signedTransaction.update({
      where: { id: legacy.signed.id },
      data: { trackingVersion: "obsolete-nonterminal-policy" },
    });
    expect(await reconcileControlIntents()).toMatchObject({ checked: 0 });
    expect(
      (await db.signedTransaction.findUniqueOrThrow({ where: { id: legacy.signed.id } })).outcome,
    ).toBe("UNRESOLVED");
  });
});
