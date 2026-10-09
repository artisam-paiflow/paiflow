import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { beforeServiceSubmission, withDeploymentWork } from "@/lib/deployments/service-work";

async function fixture(
  serviceState: "ACTIVE" | "RETIRING",
  run: (id: string, jobId: string) => Promise<void>,
) {
  const user = await db.user.create({
    data: { username: `settlement-${randomUUID()}`, passwordHash: "unused" },
  });
  const flow = await db.flow.create({
    data: {
      ownerId: user.id,
      name: "settlement",
      templateKind: "SPLITTER",
      graph: {},
      parameters: {},
    },
  });
  const deployment = await db.deployment.create({
    data: {
      ownerId: user.id,
      flowId: flow.id,
      network: "testnet",
      serviceState,
      retirementRequestedAt: serviceState === "RETIRING" ? new Date() : undefined,
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  });
  const job = await db.offRampPayoutJob.create({
    data: {
      deploymentId: deployment.id,
      source: "CASH_OUT",
      amountStroops: "10000000",
      runAt: new Date(),
    },
  });
  try {
    await run(deployment.id, job.id);
  } finally {
    await db.serviceTransaction.deleteMany({ where: { work: { deploymentId: deployment.id } } });
    await db.deploymentWork.deleteMany({ where: { deploymentId: deployment.id } });
    await db.offRampPayoutJob.deleteMany({ where: { deploymentId: deployment.id } });
    await db.deployment.delete({ where: { id: deployment.id } });
    await db.flow.delete({ where: { id: flow.id } });
    await db.user.delete({ where: { id: user.id } });
  }
}

for (const lifecycle of ["ACTIVE", "RETIRING"] as const) {
  for (const state of ["PENDING", "SUCCESS"] as const) {
    it(`${lifecycle}: unknown or uncheckpointed ${state} deposit blocks a second transfer`, async () => {
      await fixture(lifecycle, async (id, jobId) => {
        const kind = `offramp-settlement:${jobId}`;
        await db.deploymentWork.create({
          data: {
            deploymentId: id,
            kind,
            state: "DONE",
            transactions: { create: { transport: "horizon", txHash: "a".repeat(64), state } },
          },
        });
        await expect(
          withDeploymentWork(
            id,
            kind,
            () => beforeServiceSubmission("b".repeat(64), "horizon"),
            true,
            jobId,
          ),
        ).rejects.toThrow("verified outcome reconciliation");
        expect(await db.serviceTransaction.count({ where: { work: { deploymentId: id } } })).toBe(
          1,
        );
      });
    });
  }
}

it("a crashed scope blocks its own payout while another payout can drain", async () => {
  await fixture("RETIRING", async (id, jobId) => {
    await db.deploymentWork.create({
      data: { deploymentId: id, kind: `offramp-settlement:${jobId}` },
    });
    await expect(
      withDeploymentWork(id, `offramp-settlement:${jobId}`, async () => {}, true, jobId),
    ).rejects.toThrow("reconciliation");
    const other = await db.offRampPayoutJob.create({
      data: { deploymentId: id, source: "CASH_OUT", amountStroops: "10000000", runAt: new Date() },
    });
    await withDeploymentWork(
      id,
      `offramp-settlement:${other.id}`,
      () => beforeServiceSubmission("c".repeat(64), "horizon"),
      true,
      other.id,
    );
    expect(await db.serviceTransaction.count({ where: { work: { deploymentId: id } } })).toBe(1);
  });
});

it("untracked legacy RUNNING and legacy OPEN admissions require reconciliation", async () => {
  await fixture("RETIRING", async (id, jobId) => {
    await db.offRampPayoutJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
    await expect(
      withDeploymentWork(id, `offramp-settlement:${jobId}`, async () => {}, true, jobId),
    ).rejects.toThrow("reconciliation");
    await db.offRampPayoutJob.update({ where: { id: jobId }, data: { status: "PENDING" } });
    await db.deploymentWork.create({ data: { deploymentId: id, kind: "offramp-settlement" } });
    await expect(
      withDeploymentWork(id, `offramp-settlement:${jobId}`, async () => {}, true, jobId),
    ).rejects.toThrow("reconciliation");
  });
});

it("a checkpointed successful deposit permits settlement continuation", async () => {
  await fixture("RETIRING", async (id, jobId) => {
    const hash = "d".repeat(64);
    await db.offRampPayoutJob.update({ where: { id: jobId }, data: { pdaxDepositTxHash: hash } });
    const kind = `offramp-settlement:${jobId}`;
    await db.deploymentWork.create({
      data: {
        deploymentId: id,
        kind,
        state: "DONE",
        transactions: { create: { transport: "horizon", txHash: hash, state: "SUCCESS" } },
      },
    });
    await withDeploymentWork(id, kind, async () => {}, true, jobId);
  });
});

it("an older loaded submission callback records a newer module's scope", async () => {
  await fixture("ACTIVE", async (id) => {
    vi.resetModules();
    const reloaded = await import("@/lib/deployments/service-work");
    await reloaded.withDeploymentWork(id, "module-reload", () =>
      beforeServiceSubmission("e".repeat(64), "rpc"),
    );
    expect(
      await db.serviceTransaction.count({
        where: { work: { deploymentId: id }, txHash: "e".repeat(64) },
      }),
    ).toBe(1);
  });
});

it("settled legacy history does not prevent a new payout", async () => {
  await fixture("RETIRING", async (id, jobId) => {
    await db.deploymentWork.create({
      data: {
        deploymentId: id,
        kind: "offramp-settlement",
        state: "DONE",
        transactions: {
          create: { transport: "horizon", txHash: "f".repeat(64), state: "SUCCESS" },
        },
      },
    });
    await withDeploymentWork(id, `offramp-settlement:${jobId}`, async () => {}, true, jobId);
    await db.offRampPayoutJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
    await expect(
      withDeploymentWork(id, `offramp-settlement:${jobId}`, async () => {}, true, jobId),
    ).rejects.toThrow("reconciliation");
  });
});

it("simultaneous retries admit only one worker and reconciled workers cannot submit", async () => {
  await fixture("RETIRING", async (id, jobId) => {
    let release!: () => void;
    let admitted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const kind = `offramp-settlement:${jobId}`;
    const first = withDeploymentWork(
      id,
      kind,
      async () => {
        admitted();
        await blocked;
        await expect(beforeServiceSubmission("1".repeat(64), "horizon")).rejects.toThrow("fenced");
      },
      true,
      jobId,
    );
    await started;
    try {
      await expect(withDeploymentWork(id, kind, async () => {}, true, jobId)).rejects.toThrow(
        "reconciliation",
      );
      await db.deploymentWork.updateMany({
        where: { deploymentId: id, kind },
        data: {
          state: "DONE",
          reconciliationEvidence: "Verified no external submission; original worker fenced",
        },
      });
    } finally {
      release();
      await first;
    }
    expect(await db.serviceTransaction.count({ where: { work: { deploymentId: id } } })).toBe(0);
  });
});
