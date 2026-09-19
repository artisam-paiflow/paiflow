import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const { mockDb, mockPrepare, mockSubmit } = vi.hoisted(() => ({
  mockDb: { deployment: { findMany: vi.fn() } },
  mockPrepare: vi.fn(),
  mockSubmit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/env", () => ({ env: () => ({ CRON_SECRET: undefined, LOG_LEVEL: "silent" }) }));
vi.mock("@/lib/stellar/relayer", () => ({
  prepareReleaseByRelayerTx: mockPrepare,
  submitReleaseByRelayerTx: mockSubmit,
}));
vi.mock("@/lib/stellar/client", () => ({
  withRelayerLock: <T>(fn: () => Promise<T>) => fn(),
}));

import { POST } from "@/app/api/cron/auto-release/route";

describe("cron/auto-release", () => {
  beforeEach(() => {
    mockDb.deployment.findMany.mockReset();
    mockPrepare.mockReset();
    mockSubmit.mockReset();
  });

  it("never loads a sandbox deployment, and reads only the snapshot", async () => {
    mockDb.deployment.findMany.mockResolvedValue([]);

    await POST(new NextRequest("http://localhost/api/cron/auto-release"));

    expect(mockDb.deployment.findMany).toHaveBeenCalledWith({
      where: { status: "CONFIRMED", owner: { role: { not: Role.SANDBOX } } },
      select: { id: true, pipelineSnapshot: true },
    });
  });

  it("signs only for TIMELOCK nodes", async () => {
    mockDb.deployment.findMany.mockResolvedValue([
      {
        id: "d-splitter",
        pipelineSnapshot: [{ nodeId: "n1", contractAddress: "C_SPLIT", templateKind: "SPLITTER" }],
      },
      {
        id: "d-timelock",
        pipelineSnapshot: [
          { nodeId: "n1", contractAddress: "C_TRIGGER", templateKind: "DEPOSIT_TRIGGER" },
          { nodeId: "n2", contractAddress: "C_LOCK", templateKind: "TIMELOCK" },
        ],
      },
      { id: "d-no-snapshot", pipelineSnapshot: null },
    ]);
    mockPrepare.mockResolvedValue({ xdr: "AAAA" });
    mockSubmit.mockResolvedValue({ status: "SUCCESS", txHash: "abc" });

    await POST(new NextRequest("http://localhost/api/cron/auto-release"));

    expect(mockPrepare.mock.calls).toEqual([["C_LOCK"]]);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});
