import { randomUUID } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { syncEmployees } from "@/lib/employees";

const controls = vi.hoisted(() => ({
  beforeDelete: undefined as ((deploymentId: unknown) => Promise<void>) | undefined,
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    db: actual.db.$extends({
      query: {
        employee: {
          async deleteMany({ args, query }) {
            await controls.beforeDelete?.(args.where?.deploymentId);
            return query(args);
          },
        },
      },
    }),
  };
});

let ownerId: string;
const deploymentIds: string[] = [];
const address = (byte: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, byte));

beforeAll(async () => {
  ownerId = (
    await db.user.create({
      data: { username: `employees-${randomUUID()}`, passwordHash: "unused" },
    })
  ).id;
});
afterEach(() => {
  controls.beforeDelete = undefined;
});

afterAll(async () => {
  if (!ownerId) return;
  await db.deployment.deleteMany({ where: { id: { in: deploymentIds } } });
  await db.flow.deleteMany({ where: { ownerId } });
  await db.user.delete({ where: { id: ownerId } });
});

it("removes only unused roster rows while preserving payout history and other deployments", async () => {
  const flow = await db.flow.create({
    data: { ownerId, name: "Crypto payroll", templateKind: "PAYROLL", graph: {}, parameters: {} },
  });
  const createDeployment = async () => {
    const deployment = await db.deployment.create({
      data: { ownerId, flowId: flow.id, network: "testnet", graphSnapshot: {}, paramsSnapshot: {} },
    });
    deploymentIds.push(deployment.id);
    return deployment;
  };
  const deployment = await createDeployment();
  const otherDeployment = await createDeployment();
  const paid = await db.employee.create({
    data: {
      deploymentId: deployment.id,
      address: address(1),
      amountStroops: "10000000",
      label: "Paid",
    },
  });
  const stale = await db.employee.create({
    data: { deploymentId: deployment.id, address: address(2), amountStroops: "20000000" },
  });
  const current = await db.employee.create({
    data: { deploymentId: deployment.id, address: address(3), amountStroops: "30000000" },
  });
  const other = await db.employee.create({
    data: { deploymentId: otherDeployment.id, address: stale.address, amountStroops: "40000000" },
  });
  const run = await db.payrollRun.create({
    data: {
      deploymentId: deployment.id,
      runAt: new Date(),
      status: "CHARGED",
      totalStroops: paid.amountStroops,
    },
  });
  const payout = await db.payrollPayout.create({
    data: {
      payrollRunId: run.id,
      employeeId: paid.id,
      amountStroops: paid.amountStroops,
      txHash: "synthetic-payout-hash",
    },
  });

  await syncEmployees(deployment.id, [
    { address: current.address, amountStroops: "9007199254740993", label: "Current recipient" },
  ]);

  expect(await db.employee.findUnique({ where: { id: stale.id } })).toBeNull();
  expect(await db.employee.findUniqueOrThrow({ where: { id: paid.id } })).toEqual(paid);
  expect(await db.employee.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other);
  expect(await db.employee.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({
    address: current.address,
    amountStroops: "9007199254740993",
    label: "Current recipient",
  });
  expect(await db.payrollPayout.findUniqueOrThrow({ where: { id: payout.id } })).toEqual(payout);
  expect(await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).toEqual(run);
});

function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

async function raceFixture() {
  const flow = await db.flow.create({
    data: { ownerId, name: "Roster race", templateKind: "PAYROLL", graph: {}, parameters: {} },
  });
  const deployment = await db.deployment.create({
    data: { ownerId, flowId: flow.id, network: "testnet", graphSnapshot: {}, paramsSnapshot: {} },
  });
  deploymentIds.push(deployment.id);
  const employee = await db.employee.create({
    data: { deploymentId: deployment.id, address: address(4), amountStroops: "10000000" },
  });
  const run = await db.payrollRun.create({
    data: { deploymentId: deployment.id, runAt: new Date(), totalStroops: "10000000" },
  });
  return { deployment, employee, run };
}

async function isWaitingForLock(pid: number) {
  const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
    SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS waiting
  `;
  return row?.waiting ?? false;
}

it("waits for an admitted payout insertion before deciding a removed recipient has no history", async () => {
  const { deployment, employee, run } = await raceFixture();
  const inserted = gate();
  const commit = gate();
  let payoutPid!: number;
  const inserting = db.$transaction(
    async (tx) => {
      const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      payoutPid = connection!.pid;
      const payout = await tx.payrollPayout.create({
        data: { payrollRunId: run.id, employeeId: employee.id, amountStroops: "10000000" },
      });
      inserted.open();
      await commit.wait;
      return payout;
    },
    { timeout: 15000 },
  );
  await inserted.wait;
  const cleanup = syncEmployees(deployment.id, []);
  try {
    // The uncommitted FK insertion holds the employee's key-share lock. This
    // proves cleanup is waiting for that transaction, not merely running slowly.
    await expect
      .poll(
        async () => {
          const [row] = await db.$queryRaw<{ waiting: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE ${payoutPid}::int = ANY(pg_blocking_pids(pid))
            AND query LIKE '%Employee%'
        ) AS waiting
      `;
          return row?.waiting ?? false;
        },
        { timeout: 3000, interval: 20 },
      )
      .toBe(true);
  } finally {
    commit.open();
    await Promise.allSettled([inserting, cleanup]);
  }
  const payout = await inserting;
  await cleanup;
  expect(await db.employee.findUniqueOrThrow({ where: { id: employee.id } })).toEqual(employee);
  expect(await db.payrollPayout.findUniqueOrThrow({ where: { id: payout.id } })).toEqual(payout);
}, 15000);

it("makes a later payout fail rather than commit and disappear behind roster deletion", async () => {
  const { deployment, employee, run } = await raceFixture();
  const locked = gate();
  const remove = gate();
  controls.beforeDelete = async (id) => {
    if (id !== deployment.id) return;
    locked.open();
    await remove.wait;
  };
  const cleanup = syncEmployees(deployment.id, []);
  await Promise.race([
    locked.wait,
    cleanup.then(() => {
      throw new Error("Cleanup did not reach the delete barrier");
    }),
  ]);
  const insertStarted = gate();
  let insertPid!: number;
  const inserting = db
    .$transaction(
      async (tx) => {
        const [connection] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        insertPid = connection!.pid;
        insertStarted.open();
        return tx.payrollPayout.create({
          data: { payrollRunId: run.id, employeeId: employee.id, amountStroops: "10000000" },
        });
      },
      { timeout: 15000 },
    )
    .then(
      (payout) => ({ success: true as const, payout }),
      (error: unknown) => ({ success: false as const, error }),
    );
  await insertStarted.wait;
  try {
    await expect
      .poll(() => isWaitingForLock(insertPid), { timeout: 3000, interval: 20 })
      .toBe(true);
  } finally {
    remove.open();
    await Promise.allSettled([cleanup, inserting]);
  }
  await cleanup;
  const outcome = await inserting;
  expect(outcome.success).toBe(false);
  if (outcome.success) throw new Error("Payout unexpectedly committed against a removed recipient");
  expect(outcome.error).toMatchObject({ code: "P2003" });
  expect(await db.employee.findUnique({ where: { id: employee.id } })).toBeNull();
  expect(await db.payrollPayout.count({ where: { employeeId: employee.id } })).toBe(0);
}, 15000);
