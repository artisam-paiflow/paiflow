import { describe, expect, it, vi, afterEach } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { apiSummaryWindow } from "@/lib/analytics/api-summary";
import { ApiSummarySchema, ApiSummaryInputSchema } from "@/lib/analytics/api-summary-schema";
import { compareApiSnapshots, SnapshotReportSchema } from "@/lib/analytics/snapshot";

const start = "2026-10-10T00:00:00.000Z";
const end = "2026-10-15T10:00:00.000Z";
const totals = {
  requests: "9007199254740993",
  errors: "1",
  authentication_failures: "0",
  rate_limited: "0",
  total_duration_ms: "9007199254740993",
  mean_duration_ms: 1,
  min_duration_ms: 1,
  max_duration_ms: 1,
  newest_request: end,
};
const api = {
  query_version: 1,
  tracking_version: "api-requests-v1",
  environment: "beta",
  start,
  end,
  coverage_from: start,
  generated_at: end,
  totals,
  endpoints: [{ ...totals, endpoint: "/api/v1/deployments/:id", method: "GET" }],
};
function report(withApi = true) {
  return SnapshotReportSchema.parse({
    report_version: "usage-v2",
    cutover: start,
    start,
    end,
    generated_at: end,
    network: "testnet",
    audience: "EXTERNAL",
    totals: Object.fromEntries(
      [
        "connections",
        "connected_addresses",
        "attempts",
        "confirmed_deployments",
        "distinct_deployed_flows",
        "successful_executions",
        "transaction_using_addresses",
        "meaningful_active_accounts",
        "unresolved",
        "rejected",
        "failed",
      ].map((key) => [key, "0"]),
    ),
    ...(withApi ? { api } : {}),
  });
}
afterEach(() => vi.useRealTimers());
describe("API snapshot windows", () => {
  it("keeps midnight starts and rounds partial starts/coverage forward to complete UTC days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(end);
    expect(apiSummaryWindow(start, end, start).start.toISOString()).toBe(start);
    expect(apiSummaryWindow("2026-10-10T08:00:00+08:00", end, start).start.toISOString()).toBe(
      start,
    );
    expect(apiSummaryWindow(start, end, "2026-10-11T12:00:00Z").start.toISOString()).toBe(
      "2026-10-12T00:00:00.000Z",
    );
    const window = apiSummaryWindow("2026-10-10T01:00:00Z", end, start);
    expect(window.start.toISOString()).toBe("2026-10-11T00:00:00.000Z");
    expect(window.boundary.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(window.end.toISOString()).toBe(end);
  });
  it("allows durable historical midnight ends but refuses unavailable raw boundaries and empty windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2027-01-01T00:00:00Z");
    expect(() => apiSummaryWindow(start, "2026-10-12T00:00:00Z", start)).not.toThrow();
    expect(() => apiSummaryWindow(start, end, start)).toThrow("raw retention");
    expect(() => apiSummaryWindow(end, end, end)).toThrow("fully covered");
  });
  it("rejects malformed scopes and summary fields", () => {
    expect(
      ApiSummaryInputSchema.safeParse({
        start,
        end,
        environment: "beta",
        audience: "EXTERNAL",
        network: "testnet",
      }).success,
    ).toBe(true);
    for (const patch of [
      { totals: { ...totals, requests: 3 } },
      { totals: { ...totals, mean_duration_ms: -1 } },
      { totals: { ...totals, newest_request: "yesterday" } },
      { endpoints: [api.endpoints[0], api.endpoints[0]] },
      { end: start },
    ])
      expect(ApiSummarySchema.safeParse({ ...api, ...patch }).success).toBe(false);
  });
});
describe("API snapshot deltas", () => {
  it("retains old baselines and establishes a separate API baseline", () => {
    expect(compareApiSnapshots(report(), report(false))).toBeNull();
  });
  it("compares counts exactly and retains previous/current cumulative latency", () => {
    const before = report();
    const current = { ...report(), generated_at: "2026-10-15T11:00:00.000Z" };
    current.api!.totals = {
      ...current.api!.totals,
      requests: "9007199254740994",
      mean_duration_ms: 2,
    };
    const comparison = compareApiSnapshots(current, before)!;
    expect(comparison.totals.counts.requests?.delta).toBe("1");
    expect(comparison.totals.latency.mean_duration_ms).toEqual({ previous: 1, current: 2 });
  });
  it("includes new and disappeared endpoints, including negative corrections", () => {
    const before = report();
    const current = { ...report(), generated_at: "2026-10-15T11:00:00.000Z" };
    current.api!.endpoints = [
      { ...totals, requests: "3", endpoint: "/api/v1/deployments/:id/events", method: "GET" },
    ];
    expect(
      compareApiSnapshots(current, before)!.endpoints.map((row) => row.counts.requests?.delta),
    ).toEqual(["-9007199254740993", "3"]);
  });
  it("rejects changed API environment, coverage, start, version and backwards cutoffs", () => {
    const before = report();
    for (const patch of [
      { environment: "staging" },
      { coverage_from: "2026-10-09T00:00:00Z" },
      { start: "2026-10-11T00:00:00Z" },
      { query_version: 2 },
      { end: start },
    ]) {
      const current = {
        ...report(),
        generated_at: "2026-10-15T11:00:00.000Z",
        api: { ...report().api!, ...patch },
      };
      expect(compareApiSnapshots(current as ReturnType<typeof report>, before)).toBeNull();
    }
  });
});
