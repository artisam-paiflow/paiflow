import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role, TimelockMode } from "@prisma/client";
import { db } from "@/lib/db";

const { mockSimulate, mockSend, mockLock } = vi.hoisted(() => ({
  mockSimulate: vi.fn(),
  mockSend: vi.fn(),
  mockLock: vi.fn(<T>(fn: () => Promise<T>) => fn()),
}));
vi.mock("@/lib/stellar/relayer", () => ({
  simulateReleaseByRelayer: mockSimulate,
  sendReleaseByRelayer: mockSend,
}));
vi.mock("@/lib/stellar/client", () => ({ withRelayerLock: mockLock }));

import { POST } from "@/app/api/cron/auto-release/route";
import {
  classifySimulationError,
  runAutoRelease,
  PRE_DEADLINE_RECHECK_MS,
  SETTLED_RECHECK_MS,
} from "@/lib/timelock-release";

// Owners are named "tlrel-…", not "test-…": other files wipe "test-" owners'
// deployments in parallel, and that cascade would take these rows with it.
const OWN = { owner: { username: { startsWith: "tlrel-" } } };

async function cleanup() {
  await db.deployment.deleteMany({ where: OWN });
  await db.flow.deleteMany({ where: OWN });
  await db.user.deleteMany({ where: { username: { startsWith: "tlrel-" } } });
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function contractId(): string {
  let s = "C";
  for (let i = 0; i < 55; i++) s += B32[Math.floor(Math.random() * 32)];
  return s;
}

function simError(contract: string, code: number, inner?: { contract: string; code: number }) {
  const frames = [
    `0: [Diagnostic Event] contract:${contract}, topics:[error, Error(Contract, #${code})], data:"escalating"`,
  ];
  if (inner) {
    frames.push(
      `1: [Diagnostic Event] contract:${inner.contract}, topics:[error, Error(Contract, #${inner.code})], data:"fail_with_error"`,
    );
  }
  return `HostError: Error(Contract, #${code})\n\nEvent log (newest first):\n   ${frames.join("\n   ")}`;
}

async function makeTimelockDeployment(opts: {
  unlockAt: Date;
  mode?: "after" | "before";
  role?: Role;
  address?: string;
}) {
  const address = opts.address ?? contractId();
  const user = await db.user.create({
    data: {
      username: `tlrel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      passwordHash: "hash",
      role: opts.role ?? Role.USER,
    },
  });
  const flow = await db.flow.create({
    data: { ownerId: user.id, name: "tl", templateKind: "TIMELOCK", graph: {}, parameters: {} },
  });
  const deployment = await db.deployment.create({
    data: {
      flowId: flow.id,
      ownerId: user.id,
      network: "testnet",
      status: "CONFIRMED",
      graphSnapshot: {},
      paramsSnapshot: [
        { nodeId: "trigger", templateKind: "DEPOSIT_TRIGGER", params: { kind: "deposit_trigger" } },
        {
          nodeId: "lock",
          templateKind: "TIMELOCK",
          params: {
            kind: "timelock",
            unlockTime: Math.floor(opts.unlockAt.getTime() / 1000),
            mode: opts.mode ?? "after",
            nextStepNodeIds: [],
          },
        },
      ],
      pipelineSnapshot: [
        { nodeId: "trigger", contractAddress: contractId(), templateKind: "DEPOSIT_TRIGGER" },
        { nodeId: "lock", contractAddress: address, templateKind: "TIMELOCK" },
      ],
    },
  });
  return { deployment, address };
}

const past = () => new Date(Date.now() - 60 * 60 * 1000);
const future = () => new Date(Date.now() + 60 * 60 * 1000);
const okSim = { ok: true, latestLedger: 90, sim: { fake: "sim" } };

describe("cron/auto-release", () => {
  beforeEach(async () => {
    mockSimulate.mockReset();
    mockSend.mockReset();
    mockLock.mockClear();
    await cleanup();
  });
  afterAll(cleanup);

  it("records a legacy timelock on first sight and does not probe one that is not due", async () => {
    const { deployment, address } = await makeTimelockDeployment({ unlockAt: future() });

    const summary = await runAutoRelease();

    expect(summary.discovered).toBe(1);
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row).toMatchObject({
      deploymentId: deployment.id,
      nodeId: "lock",
      mode: TimelockMode.AFTER,
      settledLedger: null,
      unsupportedReason: null,
    });
    expect(row.nextProbeAt).toEqual(row.unlockAt);
  });

  it("releases a due timelock, and the next run does not probe it again", async () => {
    const { address } = await makeTimelockDeployment({ unlockAt: past() });
    mockSimulate.mockResolvedValue(okSim);
    mockSend.mockResolvedValue({ status: "SUCCESS", txHash: "tx1", ledger: 100 });

    const first = await runAutoRelease();

    expect(first.released).toBe(1);
    expect(mockSimulate).toHaveBeenCalledWith(address);
    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(address, okSim.sim);
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    // One short of the release ledger, so a refill later in it still wakes it.
    expect(row.settledLedger).toBe(99);
    expect(row.lastReleaseTxHash).toBe("tx1");
    expect(row.leaseUntil).toBeNull();
    expect(row.nextProbeAt!.getTime()).toBeGreaterThan(Date.now() + SETTLED_RECHECK_MS - 60_000);

    mockSimulate.mockClear();
    const second = await POST(new NextRequest("http://localhost/api/cron/auto-release"));
    expect((await second.json()).data.details).toEqual([]);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("probes a released timelock again only after a RECEIVE past its settled ledger", async () => {
    const { deployment, address } = await makeTimelockDeployment({ unlockAt: past() });
    mockSimulate.mockResolvedValue(okSim);
    mockSend.mockResolvedValue({ status: "SUCCESS", txHash: "tx1", ledger: 100 });
    await runAutoRelease();
    mockSimulate.mockClear();

    const event = (ledger: number, kind: "RECEIVE" | "PAYOUT") =>
      db.contractEvent.create({
        data: {
          deploymentId: deployment.id,
          eventId: `${address}-${ledger}-${kind}`,
          kind,
          ledger,
          txHash: "t",
          payload: {},
          occurredAt: new Date(),
        },
      });
    const empty = (latestLedger: number) =>
      mockSimulate.mockResolvedValue({ ok: false, latestLedger, error: simError(address, 4) });

    // A RECEIVE in the release's own ledger (a same-ledger refill, or the
    // release's downstream events) wakes it once; the probe finds it empty.
    await event(100, "RECEIVE");
    empty(120);
    await runAutoRelease();
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    let row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.settledLedger).toBe(120);

    // Nothing at or below the settled ledger, and no non-RECEIVE, wakes it.
    mockSimulate.mockClear();
    await event(115, "RECEIVE");
    await event(130, "PAYOUT");
    await runAutoRelease();
    expect(mockSimulate).not.toHaveBeenCalled();

    await event(121, "RECEIVE");
    empty(140);
    await runAutoRelease();
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockLock).toHaveBeenCalledTimes(1); // only the first release took the lock
    row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.settledLedger).toBe(140);
  });

  it("settles an empty timelock without taking the relayer lock", async () => {
    const { address } = await makeTimelockDeployment({ unlockAt: past() });
    mockSimulate.mockResolvedValue({ ok: false, latestLedger: 77, error: simError(address, 4) });

    const summary = await runAutoRelease();

    expect(summary.skipped).toBe(1);
    expect(mockLock).not.toHaveBeenCalled();
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.settledLedger).toBe(77);
  });

  it("keeps going when one timelock fails, and backs the failed one off", async () => {
    const bad = await makeTimelockDeployment({ unlockAt: past() });
    const good = await makeTimelockDeployment({ unlockAt: past() });
    mockSimulate.mockImplementation(async (addr: string) => {
      if (addr === bad.address) throw new Error("rpc down");
      return okSim;
    });
    mockSend.mockResolvedValue({ status: "SUCCESS", txHash: "tx2", ledger: 50 });

    const summary = await runAutoRelease();

    expect(summary).toMatchObject({ released: 1, failed: 1 });
    const failed = await db.timelockRelease.findUniqueOrThrow({
      where: { contractAddress: bad.address },
    });
    expect(failed.failureCount).toBe(1);
    expect(failed.lastError).toBe("rpc down");
    expect(failed.leaseUntil).toBeNull();
    expect(failed.nextProbeAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("never records or probes a sandbox-owned deployment", async () => {
    const { address } = await makeTimelockDeployment({ unlockAt: past(), role: Role.SANDBOX });

    const summary = await runAutoRelease();

    expect(summary.discovered).toBe(0);
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(await db.timelockRelease.count({ where: { contractAddress: address } })).toBe(0);
  });

  it("probes a Before timelock only until its deadline", async () => {
    const open = await makeTimelockDeployment({ unlockAt: future(), mode: "before" });
    const closed = await makeTimelockDeployment({ unlockAt: past(), mode: "before" });
    mockSimulate.mockResolvedValue({
      ok: false,
      latestLedger: 5,
      error: simError(open.address, 4),
    });

    await runAutoRelease();

    expect(mockSimulate.mock.calls).toEqual([[open.address]]);
    expect(await db.timelockRelease.count({ where: { contractAddress: closed.address } })).toBe(1);
  });

  it("does not send a Before release that its deadline would overtake", async () => {
    const { address } = await makeTimelockDeployment({
      unlockAt: new Date(Date.now() + 5_000),
      mode: "before",
    });
    mockSimulate.mockResolvedValue(okSim);

    const summary = await runAutoRelease();

    expect(summary.skipped).toBe(1);
    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockSend).not.toHaveBeenCalled();
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.leaseUntil).toBeNull();
  });

  it("rechecks an empty Before timelock shortly ahead of its deadline", async () => {
    const unlockAt = new Date(Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000) * 1000);
    const { address } = await makeTimelockDeployment({ unlockAt, mode: "before" });
    mockSimulate.mockResolvedValue({ ok: false, latestLedger: 5, error: simError(address, 4) });

    await runAutoRelease();

    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.nextProbeAt!.getTime()).toBe(unlockAt.getTime() - PRE_DEADLINE_RECHECK_MS);
  });

  it("records a timelock with unreadable parameters as unsupported instead of probing it", async () => {
    const { deployment, address } = await makeTimelockDeployment({ unlockAt: past() });
    await db.deployment.update({ where: { id: deployment.id }, data: { paramsSnapshot: [] } });

    await runAutoRelease();
    await runAutoRelease();

    expect(mockSimulate).not.toHaveBeenCalled();
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.unsupportedReason).toMatch(/paramsSnapshot/);
  });

  it("stops probing a timelock the relayer is not authorized to release", async () => {
    const { address } = await makeTimelockDeployment({ unlockAt: past() });
    mockSimulate.mockResolvedValue({ ok: false, latestLedger: 5, error: simError(address, 2) });

    await runAutoRelease();
    await db.timelockRelease.update({
      where: { contractAddress: address },
      data: { nextProbeAt: new Date(0) },
    });
    await runAutoRelease();

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    const row = await db.timelockRelease.findUniqueOrThrow({ where: { contractAddress: address } });
    expect(row.unsupportedReason).toMatch(/relayer/);
  });

  it("skips a row another run holds the lease on", async () => {
    const { address } = await makeTimelockDeployment({ unlockAt: past() });
    await runAutoRelease(new Date(Date.now() - 24 * 60 * 60 * 1000)); // discover only, not due then
    await db.timelockRelease.update({
      where: { contractAddress: address },
      data: { leaseUntil: future() },
    });

    await runAutoRelease();

    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe("classifySimulationError", () => {
  it("attributes an error to the timelock only when the timelock originated it", () => {
    const lock = contractId();
    const downstream = contractId();

    expect(classifySimulationError(lock, simError(lock, 3))).toEqual({ kind: "not_yet" });
    expect(classifySimulationError(lock, simError(lock, 4))).toEqual({ kind: "empty" });
    // A next step failing with its own #4, re-raised by the timelock frame.
    expect(
      classifySimulationError(lock, simError(lock, 4, { contract: downstream, code: 4 })),
    ).toEqual({ kind: "error" });
    expect(classifySimulationError(lock, "HostError: Error(Contract, #4)")).toEqual({
      kind: "error",
    });
    expect(
      classifySimulationError(lock, "trying to invoke non-existent contract function").kind,
    ).toBe("unsupported");
  });
});
