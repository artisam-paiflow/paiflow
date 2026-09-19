import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadServer(env: Record<string, string>) {
  Object.assign(process.env, env);
  vi.resetModules();
  return await import("@/lib/analytics/server");
}

const ACCOUNT = `G${"B".repeat(55)}`;

describe("captureServer", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_APP_ENV;
  });

  it("is a no-op without a PostHog key", async () => {
    const { captureServer } = await loadServer({});
    await captureServer("user-1", "login_failed", { reason: "locked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a sanitized event with environment properties", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { captureServer } = await loadServer({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_APP_ENV: "beta",
    });
    await captureServer("user-1", "deploy_failed", {
      stage: "submit",
      error_class: "upstream_rpc",
      error_code: ACCOUNT,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "deploy_failed",
      distinct_id: "user-1",
      properties: {
        stage: "submit",
        error_code: "<address>",
        app_env: "beta",
        source: "server",
      },
    });
  });

  it("lets the signing wallet's address through on its allowlisted key only", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { captureServer } = await loadServer({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    await captureServer("user-1", "deploy_confirmed", {
      deployment_id: "dep-1",
      flow_id: "flow-1",
      tx_hash: "a".repeat(64),
      signer_address: ACCOUNT,
      template_kinds: ["SPLITTER", ACCOUNT],
      has_swap: false,
      contract_count: 1,
      created_to_confirmed_ms: 1200,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.properties.signer_address).toBe(ACCOUNT);
    expect(body.properties.template_kinds).toEqual(["SPLITTER", "<address>"]);
    expect(body.properties).not.toHaveProperty("$process_person_profile");
  });

  it("marks an event anonymous with personProfile: false", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const { captureServer } = await loadServer({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    await captureServer(
      `wallet:${ACCOUNT}`,
      "login_failed",
      { reason: "locked" },
      { personProfile: false },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.distinct_id).toBe(`wallet:${ACCOUNT}`);
    expect(body.properties.$process_person_profile).toBe(false);
  });

  it("never throws when the request fails", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const { captureServer } = await loadServer({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    await expect(
      captureServer("user-1", "login_succeeded", { method: "password" }),
    ).resolves.toBeUndefined();
  });
});
