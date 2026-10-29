import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Address, xdr } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: {
    getTransaction: vi.fn<
      () => Promise<{
        status: string;
        ledger?: number;
        returnValue?: xdr.ScVal;
      }>
    >(async () => ({
      status: "NOT_FOUND",
    })),
    getLatestLedger: vi.fn(async () => ({ sequence: 200 })),
    getHealth: vi.fn(async () => ({ oldestLedger: 140, latestLedger: 200 })),
    getEvents: vi.fn(async (req: { startLedger?: number }) => {
      if (req.startLedger === 101) throw new Error("Outside retention");
      return { events: [], latestLedger: 200 };
    }),
  },
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mocks.rpc, horizon: () => ({}) }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
import { pollEventsForWithOutcome } from "@/lib/stellar/events";
import { requestRetirement, reconcileRetirement } from "@/lib/deployments/retirement";
import {
  beforeServiceSubmission,
  prepareServiceDeployment,
  observeServiceTransaction,
  withDeploymentBatch,
  withDeploymentWork,
} from "@/lib/deployments/service-work";
import { POST as verify } from "@/app/api/admin/deployments/[id]/settlement/route";
let userId: string;
let flowId: string;
let deploymentId: string;
async function fixture(status: "CONFIRMED" | "BUILDING" = "CONFIRMED") {
  userId = (
    await db.user.create({ data: { username: `review-${randomUUID()}`, passwordHash: "unused" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId: userId,
        name: "Review fixture",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
  deploymentId = (
    await db.deployment.create({
      data: {
        ownerId: userId,
        flowId,
        network: "testnet",
        status,
        graphSnapshot: {},
        paramsSnapshot: {},
        deployTxHash: "a".repeat(64),
        ...(status === "CONFIRMED" ? { contractAddress: "C123" } : {}),
      },
    })
  ).id;
  mocks.session.mockResolvedValue({ id: userId, role: "ADMIN" });
}
afterEach(async () => {
  if (!deploymentId) return;
  await db.serviceTransaction.deleteMany({ where: { work: { deploymentId } } });
  await db.deploymentWork.deleteMany({ where: { deploymentId } });
  await db.eventCursor.deleteMany({ where: { deploymentId } });
  await db.auditLog.deleteMany({ where: { userId } });
  await db.deployment.delete({ where: { id: deploymentId } });
  await db.flow.delete({ where: { id: flowId } });
  await db.user.delete({ where: { id: userId } });
});
const request = (body: Record<string, unknown>) =>
  verify(
    new NextRequest(`http://localhost/api/admin/deployments/${deploymentId}/settlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evidence: "Stopped worker; independently verified archived finality",
        confirmation: "Verified no remaining obligation",
        ...body,
      }),
    }),
    { params: Promise.resolve({ id: deploymentId }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.getTransaction.mockReset().mockResolvedValue({ status: "NOT_FOUND" });
});
it("retains ACTIVE gaps across later successful polls and requires archival attestation", async () => {
  await fixture();
  await db.eventCursor.create({ data: { deploymentId, lastLedger: 100 } });
  expect((await pollEventsForWithOutcome(deploymentId)).reasons).toContain("retention-gap");
  expect((await db.eventCursor.findUniqueOrThrow({ where: { deploymentId } })).lastLedger).toBe(
    200,
  );
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).retirementCoverageGap,
  ).toContain("101");
  expect((await pollEventsForWithOutcome(deploymentId)).status).toBe("complete");
  await requestRetirement(deploymentId, userId);
  await reconcileRetirement(deploymentId);
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
  ).toBe("RETIRING");
  expect((await request({ kind: "events", cutoffLedger: 199 })).status).toBe(409);
  expect((await request({ kind: "events", cutoffLedger: 200 })).status).toBe(200);
  await reconcileRetirement(deploymentId);
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
  ).toBe("RETIRED");
});
it("persists a detected gap even when retained-history retry fails", async () => {
  await fixture();
  await db.eventCursor.create({ data: { deploymentId, lastLedger: 100 } });
  mocks.rpc.getEvents.mockRejectedValueOnce(new Error("Outside retention"));
  mocks.rpc.getEvents.mockRejectedValueOnce(new Error("Retry unavailable"));
  expect((await pollEventsForWithOutcome(deploymentId)).reasons).toContain("retention-gap");
  expect((await db.eventCursor.findUniqueOrThrow({ where: { deploymentId } })).lastLedger).toBe(
    100,
  );
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).retirementCoverageGap,
  ).not.toBeNull();
});
it("fences crashed OPEN plus PENDING before finality and leaves payout obligations blocked", async () => {
  await fixture();
  await db.eventCursor.create({ data: { deploymentId, lastLedger: 200 } });
  const hash = "b".repeat(64);
  const work = await db.deploymentWork.create({
    data: {
      deploymentId,
      kind: "crashed",
      transactions: { create: { txHash: hash, transport: "rpc" } },
    },
  });
  const payout = await db.offRampPayoutJob.create({
    data: { deploymentId, amountStroops: "10000000", status: "FAILED", runAt: new Date() },
  });
  try {
    await requestRetirement(deploymentId, userId);
    expect(
      (await request({ kind: "transaction", txHash: hash, outcome: "SUCCESS", ledger: 199 }))
        .status,
    ).toBe(409);
    expect((await request({ kind: "work", id: work.id })).status).toBe(409);
    expect(
      (
        await request({
          kind: "fence-work",
          id: randomUUID(),
          confirmation: "Verified worker stopped",
        })
      ).status,
    ).toBe(404);
    expect(
      (await request({ kind: "fence-work", id: work.id, confirmation: "Verified worker stopped" }))
        .status,
    ).toBe(200);
    const fenced = await db.deploymentWork.findUniqueOrThrow({ where: { id: work.id } });
    expect(fenced.state).toBe("BLOCKED");
    expect(fenced.completedAt).toBeNull();
    expect(
      await db.serviceTransaction.count({ where: { workId: work.id, state: "PENDING" } }),
    ).toBe(1);
    expect((await request({ kind: "work", id: work.id })).status).toBe(409);
    expect(
      (await request({ kind: "transaction", txHash: hash, outcome: "SUCCESS", ledger: 199 }))
        .status,
    ).toBe(200);
    await reconcileRetirement(deploymentId);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
    ).toBe("RETIRING");
    expect((await request({ kind: "work", id: work.id })).status).toBe(200);
    await reconcileRetirement(deploymentId);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).retirementBlocker,
    ).toContain(payout.id);
    expect((await request({ kind: "offramp", id: payout.id })).status).toBe(200);
    await reconcileRetirement(deploymentId);
    expect(
      (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
    ).toBe("RETIRED");
    expect(
      await db.auditLog.count({ where: { userId, action: "DEPLOY_SETTLEMENT_VERIFIED" } }),
    ).toBe(4);
  } finally {
    await db.offRampPayoutJob.delete({ where: { id: payout.id } });
  }
});
it.each(["single", "batch"])(
  "keeps a paused %s worker fenced after its callback exits and denies further submissions",
  async (mode) => {
    await fixture();
    let admitted!: () => void;
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const callback = async () => {
      admitted();
      await paused;
      await expect(beforeServiceSubmission("c".repeat(64), "rpc")).rejects.toThrow("fenced");
    };
    const run =
      mode === "single"
        ? withDeploymentWork(deploymentId, "paused-settlement", callback, true)
        : withDeploymentBatch([deploymentId], "paused-settlement", callback);
    await started;
    const work = await db.deploymentWork.findFirstOrThrow({
      where: { deploymentId, kind: "paused-settlement" },
    });
    await requestRetirement(deploymentId, userId);
    try {
      expect(
        (
          await request({
            kind: "fence-work",
            id: work.id,
            confirmation: "Verified worker stopped",
          })
        ).status,
      ).toBe(200);
    } finally {
      release();
    }
    await run;
    expect((await db.deploymentWork.findUniqueOrThrow({ where: { id: work.id } })).state).toBe(
      "BLOCKED",
    );
    expect(await db.serviceTransaction.count({ where: { workId: work.id } })).toBe(0);
  },
);
const childAddresses = [
  Address.contract(Buffer.alloc(32, 1)).toString(),
  Address.contract(Buffer.alloc(32, 2)).toString(),
];
const plan = [
  { nodeId: "schedule", templateKind: "SUBSCRIPTION" },
  { nodeId: "splitter", templateKind: "SPLITTER" },
];
async function orphan(
  state: "SUCCESS" | "PENDING" = "SUCCESS",
  workState: "DONE" | "OPEN" = "DONE",
) {
  await fixture("BUILDING");
  await db.deployment.update({
    where: { id: deploymentId },
    data: { deployTxHash: null, paramsSnapshot: plan },
  });
  return db.deploymentWork.create({
    data: {
      deploymentId,
      kind: "dev-payroll-deploy",
      state: workState,
      transactions: {
        create: {
          txHash: "d".repeat(64),
          transport: "rpc",
          state,
          ledger: state === "SUCCESS" ? 199 : null,
        },
      },
    },
  });
}
it("recovers a successful DONE orphan using factory Vec<Address> and scans every child", async () => {
  await orphan();
  mocks.rpc.getTransaction.mockResolvedValue({
    status: "SUCCESS",
    ledger: 199,
    returnValue: xdr.ScVal.scvVec(childAddresses.map((a) => new Address(a).toScVal())),
  });
  await requestRetirement(deploymentId, userId);
  await reconcileRetirement(deploymentId);
  const d = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  expect(d.status).toBe("CONFIRMED");
  expect(d.deployTxHash).toBe("d".repeat(64));
  expect(d.pipelineSnapshot).toEqual(
    plan.map((n, i) => ({ ...n, contractAddress: childAddresses[i] })),
  );
  expect(d.retirementCutoffLedger).toBe(200);
  expect(d.serviceState).toBe("RETIRED");
  const filters = mocks.rpc.getEvents.mock.calls.flatMap(
    (call) =>
      (
        call[0] as {
          filters?: Array<{
            contractIds?: string[];
          }>;
        }
      ).filters ?? [],
  );
  expect(filters.flatMap((f) => f.contractIds ?? [])).toEqual(
    expect.arrayContaining(childAddresses),
  );
});
it.each(["missing", "partial", "duplicate", "single", "unknown", "rpc-error", "ambiguous"])(
  "blocks orphan retirement with %s recovery evidence",
  async (mode) => {
    await orphan(mode === "unknown" ? "PENDING" : "SUCCESS");
    const values =
      mode === "partial"
        ? childAddresses.slice(0, 1)
        : mode === "duplicate"
          ? [childAddresses[0]!, childAddresses[0]!]
          : childAddresses;
    mocks.rpc.getTransaction.mockResolvedValue({
      status: mode === "unknown" ? "NOT_FOUND" : "SUCCESS",
      ledger: 199,
      ...(mode === "missing"
        ? {}
        : {
            returnValue:
              mode === "single"
                ? new Address(childAddresses[0]!).toScVal()
                : xdr.ScVal.scvVec(values.map((a) => new Address(a).toScVal())),
          }),
    });
    if (mode === "rpc-error")
      mocks.rpc.getTransaction.mockRejectedValue(new Error("RPC unavailable"));
    if (mode === "ambiguous")
      await db.deploymentWork.create({
        data: {
          deploymentId,
          kind: "dev-payroll-deploy",
          state: "DONE",
          transactions: { create: { txHash: "e".repeat(64), transport: "rpc", state: "SUCCESS" } },
        },
      });
    await requestRetirement(deploymentId, userId);
    await reconcileRetirement(deploymentId);
    const d = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    expect(d.serviceState).toBe("RETIRING");
    expect(d.retirementCutoffLedger).toBeNull();
    expect(mocks.rpc.getEvents).not.toHaveBeenCalled();
  },
);
it("fences an OPEN orphan and only permits admin success with a complete durable pipeline", async () => {
  const work = await orphan("PENDING", "OPEN");
  await requestRetirement(deploymentId, userId);
  expect(
    (
      await request({
        kind: "transaction",
        txHash: "d".repeat(64),
        outcome: "SUCCESS",
        ledger: 199,
      })
    ).status,
  ).toBe(409);
  expect(
    (await request({ kind: "fence-work", id: work.id, confirmation: "Verified worker stopped" }))
      .status,
  ).toBe(200);
  expect(
    (
      await request({
        kind: "transaction",
        txHash: "d".repeat(64),
        outcome: "SUCCESS",
        ledger: 199,
      })
    ).status,
  ).toBe(409);
  expect(await db.serviceTransaction.count({ where: { workId: work.id, state: "PENDING" } })).toBe(
    1,
  );
  await db.deployment.update({
    where: { id: deploymentId },
    data: { pipelineSnapshot: plan.map((n, i) => ({ ...n, contractAddress: childAddresses[i] })) },
  });
  expect(
    (
      await request({
        kind: "transaction",
        txHash: "d".repeat(64),
        outcome: "SUCCESS",
        ledger: 199,
      })
    ).status,
  ).toBe(200);
  expect((await request({ kind: "work", id: work.id })).status).toBe(200);
  mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 199 });
  await reconcileRetirement(deploymentId);
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
  ).toBe("RETIRED");
});
it("atomically checkpoints relayer submission identity and pipeline before send", async () => {
  await fixture("BUILDING");
  await db.deployment.update({
    where: { id: deploymentId },
    data: { deployTxHash: null, paramsSnapshot: plan },
  });
  const snapshot = plan.map((n, i) => ({ ...n, contractAddress: childAddresses[i]! }));
  await withDeploymentWork(deploymentId, "dev-payroll-deploy", async () => {
    prepareServiceDeployment("d".repeat(64), snapshot);
    await beforeServiceSubmission("d".repeat(64), "rpc");
    const d = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    expect(d.pipelineSnapshot).toEqual(snapshot);
    expect(d.deployTxHash).toBe("d".repeat(64));
    await observeServiceTransaction("d".repeat(64), "SUCCESS", 199);
    throw new Error("Confirmation checkpoint failed");
  }).catch((e) => expect(e.message).toBe("Confirmation checkpoint failed"));
  mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 199 });
  await requestRetirement(deploymentId, userId);
  await reconcileRetirement(deploymentId);
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
  ).toBe("RETIRED");
});
it("retirement between preparation and the sole send gate creates no unknown-finality debt", async () => {
  await fixture("BUILDING");
  await db.deployment.update({
    where: { id: deploymentId },
    data: { deployTxHash: null, paramsSnapshot: plan },
  });
  await withDeploymentWork(deploymentId, "dev-payroll-deploy", async () => {
    prepareServiceDeployment(
      "d".repeat(64),
      plan.map((n, i) => ({ ...n, contractAddress: childAddresses[i]! })),
    );
    await requestRetirement(deploymentId, userId);
    await expect(beforeServiceSubmission("d".repeat(64), "rpc")).rejects.toThrow(
      "closed transaction submission",
    );
  });
  expect(await db.serviceTransaction.count({ where: { work: { deploymentId } } })).toBe(0);
  await reconcileRetirement(deploymentId);
  expect(
    (await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } })).serviceState,
  ).toBe("RETIRED");
});
it("rolls back pipeline checkpoints if durable submission tracking rejects malformed identity before send", async () => {
  await fixture("BUILDING");
  await db.deployment.update({
    where: { id: deploymentId },
    data: { deployTxHash: null, paramsSnapshot: plan },
  });
  await withDeploymentWork(deploymentId, "dev-payroll-deploy", async () => {
    const malformedHash = null as unknown as string;
    prepareServiceDeployment(
      malformedHash,
      plan.map((n, i) => ({ ...n, contractAddress: childAddresses[i]! })),
    );
    // Prisma rejects the required transaction identity after the pipeline update;
    // the real PostgreSQL transaction must roll that checkpoint back as well.
    await expect(beforeServiceSubmission(malformedHash, "rpc")).rejects.toThrow();
    const d = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
    expect(d.deployTxHash).toBeNull();
    expect(d.pipelineSnapshot).toBeNull();
    expect(await db.serviceTransaction.count({ where: { work: { deploymentId } } })).toBe(0);
  });
});
