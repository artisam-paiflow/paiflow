import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { posthogReportConfig } from "@/lib/env";
import { posthogSummary, posthogSummaryQuery } from "@/lib/analytics/posthog-report";
import { POSTHOG_METRICS, PosthogSummarySchema } from "@/lib/analytics/posthog-report-schema";

const input = {
  start: "2026-10-13T00:00:00+08:00",
  end: "2026-10-14T00:00:00+08:00",
  network: "testnet" as const,
  audience: "EXTERNAL" as const,
};
const scope = { app_env: "beta" as const, app_host: "beta.app.paiflow.xyz" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "test-read-key");
  vi.stubEnv("POSTHOG_PROJECT_ID", "610680");
  vi.stubEnv("POSTHOG_API_HOST", "https://us.posthog.com");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PostHog snapshot aggregates", () => {
  it("scopes all query branches by host, environment, network, audience, UTC window and version", () => {
    const query = posthogSummaryQuery(input, scope);
    for (const part of [
      "properties.app_env = 'beta'",
      "properties.app_host = 'beta.app.paiflow.xyz'",
      "properties.stellar_network = 'testnet'",
      "properties.audience = 'EXTERNAL'",
      "properties.tracking_version = 'usage-v2'",
      "2026-10-12 16:00:00.000",
      "2026-10-13 16:00:00.000",
    ])
      expect(query.split(part)).toHaveLength(3);
    expect(query).not.toContain("api_request_completed");
    expect(query).not.toContain("SELECT *");
  });

  it("rejects injected host/environment/window values before fetching", async () => {
    expect(() => posthogSummaryQuery(input, { ...scope, app_host: "x' OR 1=1 --" })).toThrow();
    expect(() => posthogSummaryQuery(input, { ...scope, app_env: "beta'" as "beta" })).toThrow();
    expect(() => posthogSummaryQuery({ ...input, start: "x'" }, scope)).toThrow();
    await expect(
      posthogSummary(input, { ...scope, app_host: "https://pinkraft.xyz" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests fresh bounded aggregates and saves only validated counts and public provenance", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            ["active_accounts", "2"],
            ["builder_opened", "9007199254740993"],
          ],
          hasMore: false,
          debug: "sensitive-response-property",
        }),
      ),
    );
    const result = await posthogSummary(input, scope);
    expect(result.totals.builder_opened).toBe("9007199254740993");
    expect(result.totals.deploy_failed).toBe("0");
    expect(Object.keys(result.totals)).toHaveLength(POSTHOG_METRICS.length);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://us.posthog.com/api/projects/610680/query/");
    expect(options?.redirect).toBe("error");
    expect(JSON.parse(options!.body as string).refresh).toBe("force_blocking");
    expect(JSON.stringify(result)).not.toContain("test-read-key");
    expect(JSON.stringify(result)).not.toContain("sensitive-response-property");
  });

  it("accepts nullable pagination metadata from a completed PostHog query", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [["active_accounts", "2"]],
          hasMore: null,
          query_status: null,
          error: null,
        }),
      ),
    );
    expect((await posthogSummary(input, scope)).totals.active_accounts).toBe("2");
  });

  it("accepts an explicitly empty period only with the aggregate summary row", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [["active_accounts", "0"]] })),
    );
    expect((await posthogSummary(input, scope)).totals.active_accounts).toBe("0");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    await expect(posthogSummary(input, scope)).rejects.toThrow("summary missing");
  });

  it.each([
    { results: [["active_accounts", "1"]], hasMore: true },
    { results: [["active_accounts", "1"]], query_status: { complete: false } },
    { results: [["active_accounts", "1"]], query_status: { complete: true, error: true } },
    { results: [["active_accounts", 9007199254740994]] },
    {
      results: [
        ["active_accounts", "1"],
        ["active_accounts", "2"],
      ],
    },
    {
      results: [
        ["active_accounts", "1"],
        ["unapproved-event", "5"],
      ],
    },
  ])(
    "rejects incomplete or malformed responses instead of emitting misleading zeroes",
    async (body) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
      await expect(posthogSummary(input, scope)).rejects.toThrow();
    },
  );

  it("does not expose response bodies or rejected-fetch details in errors", async () => {
    fetchMock.mockResolvedValue(new Response("sensitive response", { status: 403 }));
    await expect(posthogSummary(input, scope)).rejects.toThrow("HTTP 403");
    fetchMock.mockRejectedValue(new Error("test-read-key sensitive request"));
    await expect(posthogSummary(input, scope)).rejects.toThrow("check connectivity");
  });

  it("requires the read key and restricts credential destinations to PostHog Cloud", async () => {
    vi.stubEnv("POSTHOG_API_HOST", "https://attacker.example");
    expect(() => posthogReportConfig()).toThrow("supported POSTHOG_API_HOST");
    vi.stubEnv("POSTHOG_API_HOST", "https://eu.posthog.com");
    expect(posthogReportConfig().apiHost).toBe("https://eu.posthog.com");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    await expect(posthogSummary(input, scope)).rejects.toThrow("POSTHOG_PERSONAL_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing saved metrics and invalid provenance", () => {
    expect(
      PosthogSummarySchema.safeParse({
        query_version: 1,
        ...scope,
        api_host: "https://us.posthog.com",
        project_id: "610680",
        generated_at: new Date().toISOString(),
        totals: { active_accounts: "0" },
      }).success,
    ).toBe(false);
  });
});
