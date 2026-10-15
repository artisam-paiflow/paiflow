import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  latestCompatibleSnapshot,
  SnapshotReportSchema,
} from "@/lib/analytics/snapshot";

const previous = SnapshotReportSchema.parse({
  report_version: "usage-v2",
  cutover: "2026-10-10T00:00:00.000Z",
  generated_at: "2026-10-14T10:00:00.000Z",
  start: "2026-10-10T00:00:00.000Z",
  end: "2026-10-14T10:00:00.000Z",
  network: "testnet",
  audience: "EXTERNAL",
  totals: {
    connections: "9007199254740993",
    connected_addresses: "4",
    attempts: "10",
    confirmed_deployments: "2",
    distinct_deployed_flows: "2",
    successful_executions: "3",
    transaction_using_addresses: "4",
    meaningful_active_accounts: "3",
    unresolved: "5",
    rejected: "0",
    failed: "0",
  },
});
const current = {
  ...previous,
  generated_at: "2026-10-15T10:00:00.000Z",
  end: "2026-10-15T10:00:00.000Z",
  totals: {
    ...previous.totals,
    connections: "9007199254740994",
    unresolved: "2",
    successful_executions: "6",
  },
};

describe("analytics snapshot comparisons", () => {
  it("keeps precise counts and reports negative outcome deltas", () => {
    const delta = compareSnapshots(current, previous)!;
    expect(delta.connections?.delta).toBe("1");
    expect(delta.unresolved?.delta).toBe("-3");
    expect(delta.successful_executions?.delta).toBe("3");
    expect(delta.attempts?.delta).toBe("0");
  });

  it("compares equivalent timestamp offsets", () => {
    expect(
      compareSnapshots({ ...current, start: "2026-10-10T08:00:00+08:00" }, previous),
    ).not.toBeNull();
  });

  it("never compares different scopes, versions, or backwards windows", () => {
    for (const change of [
      { network: "mainnet" as const },
      { audience: "INTERNAL" as const },
      { start: "2026-10-11T00:00:00Z" },
      { report_version: "usage-v3" },
      { cutover: "2026-10-11T00:00:00Z" },
      { end: "2026-10-13T00:00:00Z" },
      { generated_at: previous.generated_at },
    ])
      expect(compareSnapshots({ ...current, ...change }, previous)).toBeNull();
  });

  it("selects the newest compatible baseline regardless of file order", () => {
    const older = {
      ...previous,
      generated_at: "2026-10-13T10:00:00.000Z",
      end: "2026-10-13T10:00:00.000Z",
    };
    expect(
      latestCompatibleSnapshot(current, [previous, { ...previous, network: "mainnet" }, older]),
    ).toBe(previous);
    expect(latestCompatibleSnapshot(current, [])).toBeUndefined();
  });

  it("rejects missing or malformed counters instead of treating them as zero", () => {
    expect(
      SnapshotReportSchema.safeParse({
        ...previous,
        totals: { ...previous.totals, attempts: "unknown" },
      }).success,
    ).toBe(false);
  });
});
