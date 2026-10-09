import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Address } from "@stellar/stellar-sdk";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import {
  beforeServiceSubmission,
  beforeExternalRelayer,
  withDeploymentWork,
  observeServiceTransaction,
  assertDeploymentService,
} from "@/lib/deployments/service-work";
import { db } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  rpc: { getTransaction: vi.fn(), getLatestLedger: vi.fn() },
  coverage: vi.fn(),
  session: vi.fn(),
  extract: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mocks.rpc, horizon: () => ({}) }));
vi.mock("@/lib/stellar/events", () => ({
  pollEventsForWithOutcome: mocks.coverage,
  reconcileStoredCashOutObligations: vi.fn(async () => true),
}));
vi.mock("@/lib/stellar/deploy", () => ({ extractCreatedContract: mocks.extract }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));

import { requestRetirement, reconcileRetirement } from "@/lib/deployments/retirement";
import { getDueOffRampJobs } from "@/lib/offramp/jobs";
import { getDueStreamerJobs } from "@/lib/streamer-jobs";
import { createCashOutJob } from "@/lib/offramp/jobs";
import { POST as retire, GET as progress } from "@/app/api/deployments/[id]/retirement/route";
import { POST as verify } from "@/app/api/admin/deployments/[id]/settlement/route";
import { DELETE as deleteFlow } from "@/app/api/flows/[id]/route";

let ownerId: string;
let flowId: string;
const suffix = randomUUID();
const deployments: string[] = [];
const extraFlows: string[] = [];
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}
async function deployment(data: { status?: "DRAFT" | "CONFIRMED"; contractAddress?: string } = {}) {
  const d = await db.deployment.create({
    data: { flowId, ownerId, network: "testnet", graphSnapshot: {}, paramsSnapshot: {}, ...data },
  });
  deployments.push(d.id);
  return d;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const confirmation = {
  confirmation: "Permanently retire deployment",
  irreversible: true,
  onChainResponsibility: true,
};
beforeAll(async () => {
  ownerId = (
    await db.user.create({ data: { username: `retirement-${suffix}`, passwordHash: "unused" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: { ownerId, name: "retirement", templateKind: "SPLITTER", graph: {}, parameters: {} },
    })
  ).id;
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: ownerId, role: "USER" });
  mocks.extract.mockReturnValue(null);
  mocks.rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.rpc.getLatestLedger.mockResolvedValue({ sequence: 600 });
  mocks.coverage.mockResolvedValue({ status: "complete", scannedThrough: 600, reasons: [] });
});
afterAll(async () => {
  await db.serviceTransaction.deleteMany({
    where: { work: { deploymentId: { in: deployments } } },
  });
  await db.deploymentWork.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.offRampPayoutJob.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.contractEvent.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.auditLog.deleteMany({ where: { userId: ownerId } });
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  await db.flow.deleteMany({ where: { id: { in: [flowId, ...extraFlows] } } });
  await db.user.delete({ where: { id: ownerId } });
});
describe("retirement with real PostgreSQL admission locks", () => {
  it("closes new admissions while previously admitted work is still running", async () => {
    const d = await deployment();
    const entered = gate();
    const release = gate();
    const running = withDeploymentWork(d.id, "owner-submit", async () => {
      entered.open();
      await release.wait;
      await expect(beforeServiceSubmission("a".repeat(64), "rpc")).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
    await entered.wait;
    await requestRetirement(d.id, ownerId);
    await expect(
      withDeploymentWork(d.id, "loaded-worker", async () => {
        throw new Error("must not execute");
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRING",
    );
    release.open();
    await running;
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
  });
  it("does not treat a legacy deployment timeout as verified failure", async () => {
    const d = await deployment();
    const hash = "e".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "FAILED", deployTxHash: hash, errorMessage: "Timed out before finality" },
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRING",
    );
    expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(
      1,
    );
    mocks.rpc.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 599 });
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
  });
  it("keeps a legacy BUILDING hash pending until verified finality, then permits failure retirement", async () => {
    const d = await deployment();
    const hash = "1".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "BUILDING", deployTxHash: hash },
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementCutoffLedger).toBeNull();
    expect(row.retirementReconciledAt).toBeNull();
    expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(
      1,
    );
    expect(mocks.coverage).not.toHaveBeenCalled();
    mocks.rpc.getTransaction.mockResolvedValue({ status: "FAILED", ledger: 599 });
    await reconcileRetirement(d.id);
    row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("FAILED");
    expect(row.serviceState).toBe("RETIRED");
    expect(row.retirementCutoffLedger).toBe(0);
  });
  it("blocks legacy BUILDING success until its deployed reference is recovered", async () => {
    const d = await deployment();
    const hash = "2".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "BUILDING", deployTxHash: hash },
    });
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 599 });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("BUILDING");
    expect(row.serviceState).toBe("RETIRING");
    expect(row.contractAddress).toBeNull();
    expect(row.retirementCutoffLedger).toBeNull();
    expect(row.retirementReconciledAt).toBeNull();
    expect(row.retirementBlocker).toContain("verified recovery");
    expect(mocks.coverage).not.toHaveBeenCalled();
    await reconcileRetirement(d.id);
    expect(mocks.coverage).not.toHaveBeenCalled();
    await db.deployment.update({
      where: { id: d.id },
      data: { contractAddress: `recovered-${suffix}` },
    });
    await reconcileRetirement(d.id);
    row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.retirementCutoffLedger).toBe(600);
    expect(row.serviceState).toBe("RETIRED");
    expect(mocks.coverage).toHaveBeenCalledWith(d.id, { retirementCutoff: 600 });
  });
  it("recovers a tracked BUILDING success reference and reconciles its nonzero cutoff", async () => {
    const d = await deployment();
    const hash = "3".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "BUILDING", deployTxHash: hash },
    });
    await withDeploymentWork(d.id, "deployment-submit", () => beforeServiceSubmission(hash, "rpc"));
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 599 });
    mocks.extract.mockReturnValue(`created-${suffix}`);
    await requestRetirement(d.id, ownerId);
    expect(await db.serviceTransaction.count({ where: { txHash: hash } })).toBe(1);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(row.contractAddress).toBe(`created-${suffix}`);
    expect(row.retirementCutoffLedger).toBe(600);
    expect(row.serviceState).toBe("RETIRED");
    expect(mocks.coverage).toHaveBeenCalledWith(d.id, { retirementCutoff: 600 });
  });
  it.each(["FAILED", "REJECTED"] as const)(
    "recovers stale BUILDING metadata from durable %s finality without RPC history",
    async (state) => {
      const d = await deployment();
      const hash = (state === "FAILED" ? "a1" : "a2").repeat(32);
      await db.deployment.update({
        where: { id: d.id },
        data: { status: "BUILDING", deployTxHash: hash },
      });
      await withDeploymentWork(d.id, "deployment-submit", async () => {
        await beforeServiceSubmission(hash, "rpc");
        await observeServiceTransaction(hash, state, state === "FAILED" ? 599 : undefined);
      });
      await requestRetirement(d.id, ownerId);
      await reconcileRetirement(d.id);
      const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("FAILED");
      expect(row.serviceState).toBe("RETIRED");
      expect(row.retirementCutoffLedger).toBe(0);
      expect(mocks.coverage).not.toHaveBeenCalled();
    },
  );
  it.each(["BUILDING", "FAILED"] as const)(
    "recovers a previously recorded SUCCESS with stale %s deployment metadata",
    async (status) => {
      const d = await deployment();
      const hash = (status === "BUILDING" ? "8" : "9").repeat(64);
      await db.deployment.update({ where: { id: d.id }, data: { status, deployTxHash: hash } });
      await withDeploymentWork(d.id, "deployment-submit", async () => {
        await beforeServiceSubmission(hash, "rpc");
        await observeServiceTransaction(hash, "SUCCESS", 599);
      });
      await requestRetirement(d.id, ownerId);
      await reconcileRetirement(d.id);
      let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.serviceState).toBe("RETIRING");
      expect(row.retirementCutoffLedger).toBeNull();
      expect(row.retirementReconciledAt).toBeNull();
      expect(mocks.coverage).not.toHaveBeenCalled();
      mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 599 });
      mocks.extract.mockReturnValue(`historical-created-${status}-${suffix}`);
      await reconcileRetirement(d.id);
      row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("CONFIRMED");
      expect(row.contractAddress).toBe(`historical-created-${status}-${suffix}`);
      expect(row.serviceState).toBe("RETIRED");
      expect(row.retirementCutoffLedger).toBe(600);
      expect(mocks.coverage).toHaveBeenCalledWith(d.id, { retirementCutoff: 600 });
    },
  );
  it("retries BUILDING reference recovery before recording terminal submission finality", async () => {
    const d = await deployment();
    const hash = "7".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "BUILDING", deployTxHash: hash },
    });
    await withDeploymentWork(d.id, "deployment-submit", () => beforeServiceSubmission(hash, "rpc"));
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 599 });
    mocks.extract.mockReturnValue(`retry-created-${suffix}`);
    await requestRetirement(d.id, ownerId);
    const recovery = vi
      .spyOn(db.deployment, "updateMany")
      .mockRejectedValueOnce(new Error("Transient database failure"));
    try {
      await reconcileRetirement(d.id);
      expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(
        1,
      );
      let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.serviceState).toBe("RETIRING");
      expect(row.retirementCutoffLedger).toBeNull();
      await reconcileRetirement(d.id);
      row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.contractAddress).toBe(`retry-created-${suffix}`);
      expect(row.serviceState).toBe("RETIRED");
      expect(row.retirementCutoffLedger).toBe(600);
      expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "SUCCESS" } })).toBe(
        1,
      );
    } finally {
      recovery.mockRestore();
    }
  });
  it.each(["SUCCESS", "FAILED"] as const)(
    "recovers legacy BUILDING from archived %s finality",
    async (outcome) => {
      const d = await deployment();
      const hash = (outcome === "SUCCESS" ? "4" : "5").repeat(64);
      const address = Address.contract(Buffer.alloc(32, 3)).toString();
      await db.deployment.update({
        where: { id: d.id },
        data: {
          status: "BUILDING",
          deployTxHash: hash,
          pipelineSnapshot: [
            { nodeId: "root", templateKind: "SPLITTER", contractAddress: address },
          ],
        },
      });
      await requestRetirement(d.id, ownerId);
      mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
      const response = await verify(
        req("POST", `/api/admin/deployments/${d.id}/settlement`, {
          kind: "transaction",
          txHash: hash,
          outcome,
          ledger: 599,
          evidence: "Archived deployment hash finality independently verified",
          confirmation: "Verified no remaining obligation",
        }),
        ctx(d.id),
      );
      expect(response.status).toBe(200);
      await reconcileRetirement(d.id);
      const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe(outcome === "SUCCESS" ? "CONFIRMED" : "FAILED");
      expect(row.serviceState).toBe("RETIRED");
      expect(row.retirementCutoffLedger).toBe(outcome === "SUCCESS" ? 600 : 0);
      if (outcome === "SUCCESS")
        expect(mocks.coverage).toHaveBeenCalledWith(d.id, { retirementCutoff: 600 });
    },
  );
  it("allows archival recovery of recorded BUILDING success after RPC history expires", async () => {
    const d = await deployment();
    const hash = "a3".repeat(32);
    const address = Address.contract(Buffer.alloc(32, 4)).toString();
    await db.deployment.update({
      where: { id: d.id },
      data: {
        status: "BUILDING",
        deployTxHash: hash,
        pipelineSnapshot: [{ nodeId: "root", templateKind: "SPLITTER", contractAddress: address }],
      },
    });
    await withDeploymentWork(d.id, "deployment-submit", async () => {
      await beforeServiceSubmission(hash, "rpc");
      await observeServiceTransaction(hash, "SUCCESS", 599);
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).retirementCutoffLedger,
    ).toBeNull();
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const response = await verify(
      req("POST", `/api/admin/deployments/${d.id}/settlement`, {
        kind: "transaction",
        txHash: hash,
        outcome: "SUCCESS",
        ledger: 599,
        evidence: "Archived deployment result and stored pipeline addresses independently verified",
        confirmation: "Verified no remaining obligation",
      }),
      ctx(d.id),
    );
    expect(response.status).toBe(200);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.status).toBe("CONFIRMED");
    expect(row.contractAddress).toBe(address);
    expect(row.serviceState).toBe("RETIRED");
    expect(row.retirementCutoffLedger).toBe(600);
    expect(mocks.coverage).toHaveBeenCalledWith(d.id, { retirementCutoff: 600 });
  });
  it("rejects archived BUILDING success without a verified deployed reference", async () => {
    const d = await deployment();
    const hash = "6".repeat(64);
    await db.deployment.update({
      where: { id: d.id },
      data: { status: "BUILDING", deployTxHash: hash },
    });
    await requestRetirement(d.id, ownerId);
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const response = await verify(
      req("POST", `/api/admin/deployments/${d.id}/settlement`, {
        kind: "transaction",
        txHash: hash,
        outcome: "SUCCESS",
        ledger: 599,
        evidence: "Archived deployment hash finality independently verified",
        confirmation: "Verified no remaining obligation",
      }),
      ctx(d.id),
    );
    expect(response.status).toBe(409);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementCutoffLedger).toBeNull();
    expect(row.retirementReconciledAt).toBeNull();
    expect(await db.serviceTransaction.count({ where: { txHash: hash, state: "PENDING" } })).toBe(
      1,
    );
    expect(mocks.coverage).not.toHaveBeenCalled();
  });
  it("rechecks a coverage gap written after event reconciliation under the final retirement lock", async () => {
    const d = await deployment({ status: "CONFIRMED", contractAddress: `late-gap-${suffix}` });
    mocks.coverage.mockImplementationOnce(async () => {
      await db.deployment.update({
        where: { id: d.id },
        data: { retirementCoverageGap: "Concurrent poll detected missing historical ledgers" },
      });
      return { status: "complete", scannedThrough: 600, reasons: [] };
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.retirementReconciledAt).not.toBeNull();
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementBlocker).toBe(row.retirementCoverageGap);
  });
  it("blocks ambiguous legacy payout replay and deduplicates verified event linkage", async () => {
    const d = await deployment();
    const event = await db.contractEvent.create({
      data: {
        deploymentId: d.id,
        eventId: randomUUID(),
        txHash: "f".repeat(64),
        kind: "CASH_OUT",
        ledger: 599,
        payload: {},
        occurredAt: new Date(),
      },
    });
    const opts = {
      deploymentId: d.id,
      sourceAddress: "legacy-source",
      amountStroops: "10000000",
      bankAccountName: "Test recipient",
      bankAccountNumber: "00000001",
      bankCode: "TEST",
    };
    const legacy = await createCashOutJob(db, opts);
    await expect(
      createCashOutJob(db, { ...opts, originatingEventId: event.id, replayingEvent: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.offRampPayoutJob.count({ where: { deploymentId: d.id } })).toBe(1);
    await db.offRampPayoutJob.update({
      where: { id: legacy.id },
      data: { originatingEventId: event.id },
    });
    expect(
      (await createCashOutJob(db, { ...opts, originatingEventId: event.id, replayingEvent: true }))
        .id,
    ).toBe(legacy.id);
    expect(await db.offRampPayoutJob.count({ where: { deploymentId: d.id } })).toBe(1);
  });
  it("holds independent admission for a poll that outlives its outer response", async () => {
    const d = await deployment();
    const entered = gate();
    const release = gate();
    let nested!: Promise<void>;
    await withDeploymentWork(d.id, "response", async () => {
      nested = withDeploymentWork(d.id, "background-poll", async () => {
        entered.open();
        await release.wait;
      });
      await entered.wait;
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRING",
    );
    release.open();
    await nested;
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
  });
  it("enforces owner isolation and lifecycle with the real route boundary", async () => {
    const d = await deployment();
    const handler = vi.fn(async () => new Response("ok"));
    const route = deploymentServiceRoute(handler, "owner");
    mocks.session.mockResolvedValue({ id: randomUUID(), role: "USER" });
    expect((await route(req("POST", `/api/deployments/${d.id}/trigger`), ctx(d.id))).status).toBe(
      404,
    );
    expect(handler).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ id: ownerId, role: "SANDBOX" });
    expect((await route(req("POST", `/api/deployments/${d.id}/trigger`), ctx(d.id))).status).toBe(
      200,
    );
    await requestRetirement(d.id, ownerId);
    expect((await route(req("POST", `/api/deployments/${d.id}/trigger`), ctx(d.id))).status).toBe(
      409,
    );
    await reconcileRetirement(d.id);
    expect((await route(req("GET", `/api/deployments/${d.id}/trigger`), ctx(d.id))).status).toBe(
      404,
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("excludes retired jobs before the worker limit while retaining obligated retiring payouts", async () => {
    const retired = await deployment();
    await requestRetirement(retired.id, ownerId);
    await reconcileRetirement(retired.id);
    const draining = await deployment();
    await requestRetirement(draining.id, ownerId);
    const active = await deployment();
    for (const d of [retired, draining, active]) {
      await db.offRampPayoutJob.create({
        data: {
          deploymentId: d.id,
          source: "CASH_OUT",
          amountStroops: "10000000",
          bankAccountName: "Test",
          bankAccountNumber: "00000001",
          bankCode: "TEST",
          runAt: new Date(0),
        },
      });
      await db.streamerClaimJob.create({
        data: { deploymentId: d.id, nodeId: "s", contractAddress: "Cstream", runAt: new Date(0) },
      });
    }
    const payouts = await getDueOffRampJobs(db, 1);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.deploymentId).not.toBe(retired.id);
    const streams = await getDueStreamerJobs(db, 1);
    expect(streams).toHaveLength(1);
    expect(streams[0]?.deploymentId).toBe(active.id);
  });
  it("never times out an unknown submission into settlement", async () => {
    const d = await deployment();
    const hash = "b".repeat(64);
    await withDeploymentWork(d.id, "submit", () => beforeServiceSubmission(hash, "rpc"));
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementBlocker).toContain(hash);
    expect(row.retirementCutoffLedger).toBeNull();
    await observeServiceTransaction(hash, "FAILED", 599, true);
    await reconcileRetirement(d.id);
    row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRED");
    expect(await db.serviceTransaction.count({ where: { txHash: hash } })).toBe(1);
  });
  it("allows independently verified archived finality without forcing remaining payout settlement", async () => {
    const d = await deployment();
    const hash = "d".repeat(64);
    await withDeploymentWork(d.id, "submit", () => beforeServiceSubmission(hash, "rpc"));
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    const job = await createCashOutJob(db, {
      deploymentId: d.id,
      sourceAddress: "cash-out",
      amountStroops: "10000000",
      bankAccountName: "Test",
      bankAccountNumber: "00000001",
      bankCode: "TEST",
    });
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const response = await verify(
      req("POST", `/api/admin/deployments/${d.id}/settlement`, {
        kind: "transaction",
        txHash: hash,
        outcome: "SUCCESS",
        ledger: 599,
        evidence: "Archived ledger independently verified for exact hash",
        confirmation: "Verified no remaining obligation",
      }),
      ctx(d.id),
    );
    expect(response.status).toBe(200);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementBlocker).toContain(job.id);
    expect(
      await db.auditLog.count({ where: { userId: ownerId, action: "DEPLOY_SETTLEMENT_VERIFIED" } }),
    ).toBeGreaterThan(0);
  });
  it("blocks on crashed work and opaque external relayer outcomes", async () => {
    const d = await deployment();
    await withDeploymentWork(d.id, "tenant-charge", async () => {
      await beforeExternalRelayer();
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    const work = await db.deploymentWork.findFirstOrThrow({ where: { deploymentId: d.id } });
    expect(work.state).toBe("BLOCKED");
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).retirementBlocker,
    ).toContain("External relayer");
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const response = await verify(
      req("POST", `/api/admin/deployments/${d.id}/settlement`, {
        kind: "work",
        id: work.id,
        evidence: "Verified tenant recovery receipt: funds returned and no transaction remains",
        confirmation: "Verified no remaining obligation",
      }),
      ctx(d.id),
    );
    expect(response.status).toBe(200);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
  });
  it("a failed provider deposit is not settled until recovery is verified", async () => {
    const d = await deployment();
    const job = await db.offRampPayoutJob.create({
      data: {
        deploymentId: d.id,
        amountStroops: "10000000",
        runAt: new Date(),
        status: "FAILED",
        pdaxDepositTxHash: "c".repeat(64),
      },
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).retirementBlocker,
    ).toContain("provider deposit");
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    expect(
      (
        await verify(
          req("POST", `/api/admin/deployments/${d.id}/settlement`, {
            kind: "offramp",
            id: job.id,
            evidence: "Verified provider recovery receipt for the complete committed amount",
            confirmation: "Verified no remaining obligation",
          }),
          ctx(d.id),
        )
      ).status,
    ).toBe(200);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
    expect(await db.offRampPayoutJob.count({ where: { id: job.id } })).toBe(1);
  });
  it("fixes a cutoff and blocks on incomplete or retention-gap coverage", async () => {
    const d = await deployment({ status: "CONFIRMED", contractAddress: `cutoff-${suffix}` });
    mocks.coverage.mockResolvedValueOnce({
      status: "partial",
      scannedThrough: 580,
      reasons: ["retention-gap"],
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    let row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementCutoffLedger).toBe(600);
    expect(row.retirementBlocker).toContain("retention-gap");
    mocks.rpc.getLatestLedger.mockResolvedValue({ sequence: 900 });
    await reconcileRetirement(d.id);
    row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRING");
    expect(row.retirementCutoffLedger).toBe(600);
    expect(mocks.coverage).toHaveBeenCalledTimes(1);
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    expect(
      (
        await verify(
          req("POST", `/api/admin/deployments/${d.id}/settlement`, {
            kind: "events",
            cutoffLedger: 600,
            evidence:
              "Archived events reconciled through cutoff; every committed obligation persisted",
            confirmation: "Verified no remaining obligation",
          }),
          ctx(d.id),
        )
      ).status,
    ).toBe(200);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
    expect(mocks.coverage).toHaveBeenLastCalledWith(d.id, { retirementCutoff: 600 });
  });
  it("ignores future schedules and balances, and cancels unstarted streaming claims", async () => {
    const d = await deployment();
    await db.deployment.update({
      where: { id: d.id },
      data: { nextChargeAt: new Date("2090-01-01"), chargeRelayerMode: "PLATFORM" },
    });
    await db.streamerClaimJob.create({
      data: {
        deploymentId: d.id,
        nodeId: "s",
        contractAddress: "Cstream",
        runAt: new Date("2090-01-01"),
      },
    });
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    const row = await db.deployment.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.serviceState).toBe("RETIRED");
    expect(row.nextChargeAt).toBeNull();
    expect(
      (await db.streamerClaimJob.findFirstOrThrow({ where: { deploymentId: d.id } })).status,
    ).toBe("CANCELLED");
    expect(mocks.rpc.getLatestLedger).not.toHaveBeenCalled();
  });
  it("requires worker fencing before verifying a crashed streaming claim", async () => {
    const d = await deployment();
    const claim = await db.streamerClaimJob.create({
      data: {
        deploymentId: d.id,
        nodeId: "s",
        contractAddress: "Cstream",
        runAt: new Date(),
        status: "RUNNING",
      },
    });
    const work = await db.deploymentWork.create({
      data: { deploymentId: d.id, kind: "crashed-streamer" },
    });
    await requestRetirement(d.id, ownerId);
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const body = {
      kind: "streamer",
      id: claim.id,
      outcome: "SKIPPED",
      confirmation: "Verified no remaining obligation",
      evidence: "Worker independently fenced and verified no submitted claim remains",
    };
    expect(
      (await verify(req("POST", `/api/admin/deployments/${d.id}/settlement`, body), ctx(d.id)))
        .status,
    ).toBe(409);
    expect(
      (
        await verify(
          req("POST", `/api/admin/deployments/${d.id}/settlement`, {
            kind: "work",
            id: work.id,
            confirmation: body.confirmation,
            evidence: body.evidence,
          }),
          ctx(d.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (await verify(req("POST", `/api/admin/deployments/${d.id}/settlement`, body), ctx(d.id)))
        .status,
    ).toBe(200);
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRED",
    );
    expect(await db.streamerClaimJob.count({ where: { deploymentId: d.id } })).toBe(1);
  });
  it("keeps owner progress visible during retirement and refuses access afterwards", async () => {
    const d = await deployment();
    const work = await db.deploymentWork.create({ data: { deploymentId: d.id, kind: "crashed" } });
    const requested = await retire(
      req("POST", `/api/deployments/${d.id}/retirement`, confirmation),
      ctx(d.id),
    );
    expect(requested.status).toBe(200);
    expect((await requested.json()).data.serviceState).toBe("RETIRING");
    expect(
      (await progress(req("GET", `/api/deployments/${d.id}/retirement`), ctx(d.id))).status,
    ).toBe(200);
    mocks.session.mockResolvedValue({ id: randomUUID(), role: "USER" });
    expect(
      (await progress(req("GET", `/api/deployments/${d.id}/retirement`), ctx(d.id))).status,
    ).toBe(404);
    mocks.session.mockResolvedValue({ id: ownerId, role: "USER" });
    await db.deploymentWork.update({
      where: { id: work.id },
      data: {
        state: "DONE",
        completedAt: new Date(),
        reconciliationEvidence: "Test verified no submitted transaction",
      },
    });
    await reconcileRetirement(d.id);
    await expect(assertDeploymentService(d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await progress(req("GET", `/api/deployments/${d.id}/retirement`), ctx(d.id))).status,
    ).toBe(404);
    await expect(
      db.deployment.update({ where: { id: d.id }, data: { serviceState: "ACTIVE" } }),
    ).rejects.toThrow();
  });
  it("permanently deletes only unused flows and preserves the FK during a deploy/delete race", async () => {
    const f = await db.flow.create({
      data: { ownerId, name: "unused", templateKind: "SPLITTER", graph: {}, parameters: {} },
    });
    extraFlows.push(f.id);
    expect(
      (
        await deleteFlow(
          req("DELETE", `/api/flows/${f.id}`, { confirmation: "Permanently delete flow" }),
          ctx(f.id),
        )
      ).status,
    ).toBe(200);
    const d = await deployment();
    await requestRetirement(d.id, ownerId);
    await reconcileRetirement(d.id);
    const refused = await deleteFlow(
      req("DELETE", `/api/flows/${flowId}`, { confirmation: "Permanently delete flow" }),
      ctx(flowId),
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()).error.message).toContain("any deployment");
    const racing = await db.flow.create({
      data: { ownerId, name: "racing", templateKind: "SPLITTER", graph: {}, parameters: {} },
    });
    extraFlows.push(racing.id);
    const results = await Promise.allSettled([
      db.flow.delete({ where: { id: racing.id } }),
      db.deployment.create({
        data: {
          flowId: racing.id,
          ownerId,
          network: "testnet",
          graphSnapshot: {},
          paramsSnapshot: {},
        },
      }),
    ]);
    if (results[1]?.status === "fulfilled") deployments.push(results[1].value.id);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });
  it("requires worker fencing and finality before resolving a crashed RUNNING payout", async () => {
    const d = await deployment();
    const job = await db.offRampPayoutJob.create({
      data: { deploymentId: d.id, amountStroops: "10000000", runAt: new Date(), status: "RUNNING" },
    });
    const work = await db.deploymentWork.create({
      data: {
        deploymentId: d.id,
        kind: `offramp-settlement:${job.id}`,
        transactions: { create: { txHash: "9".repeat(64), transport: "horizon" } },
      },
    });
    await requestRetirement(d.id, ownerId);
    mocks.session.mockResolvedValue({ id: ownerId, role: "ADMIN" });
    const attest = () =>
      verify(
        req("POST", `/api/admin/deployments/${d.id}/settlement`, {
          kind: "offramp",
          id: job.id,
          evidence: "Worker process stopped; independently verified full refund receipt",
          confirmation: "Verified no remaining obligation",
        }),
        ctx(d.id),
      );
    expect((await attest()).status).toBe(409);
    await db.deploymentWork.update({
      where: { id: work.id },
      data: {
        state: "DONE",
        reconciliationEvidence: "Process stopped; receipt independently verified",
      },
    });
    expect((await attest()).status).toBe(409);
    await db.serviceTransaction.updateMany({
      where: { workId: work.id },
      data: { state: "SUCCESS", ledger: 500 },
    });
    expect((await attest()).status).toBe(200);
    const settled = await db.offRampPayoutJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(settled.status).toBe("CANCELLED");
    expect(settled.settlementResolvedAt).not.toBeNull();
    expect(settled.settlementEvidence).toContain("full refund receipt");
    // Resolving this job must not silently abandon another committed payout.
    await db.offRampPayoutJob.create({
      data: { deploymentId: d.id, amountStroops: "10000000", runAt: new Date(), status: "RUNNING" },
    });
    await reconcileRetirement(d.id);
    expect((await db.deployment.findUniqueOrThrow({ where: { id: d.id } })).serviceState).toBe(
      "RETIRING",
    );
  });
});
