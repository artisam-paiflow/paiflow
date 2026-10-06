/**
 * `resetIdentity` has to decide against posthog-js's persisted state, not the
 * module-level `identifiedUserId`: after a reload that variable is null while
 * the cookie still carries the previous user's distinct id. The provider calls
 * `resetIdentity` on every anonymous mount, so an early return there leaves
 * later pageviews and wallet events attributed to whoever signed in last.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fake } = vi.hoisted(() => {
  const fake = {
    identified: false,
    init: vi.fn((_key: string, config: { loaded?: (ph: unknown) => void }) => {
      config.loaded?.(fake);
    }),
    register: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn((_id: string) => {
      fake.identified = true;
    }),
    reset: vi.fn(() => {
      fake.identified = false;
    }),
    _isIdentified: vi.fn(() => fake.identified),
    setPersonProperties: vi.fn(),
  };
  return { fake };
});

vi.mock("posthog-js", () => ({ default: fake }));
vi.mock("posthog-js/dist/exception-autocapture", () => ({}));
vi.mock("posthog-js/dist/dead-clicks-autocapture", () => ({}));

async function freshClient() {
  vi.resetModules();
  return import("@/lib/analytics/client");
}

async function flush() {
  // loadAnalytics awaits dynamic imports, which settle on a later macrotask.
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}

describe("resetIdentity", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fake.identified = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  it("resets a persisted identity on an anonymous mount after a reload", async () => {
    // A previous page life identified this browser; posthog-js remembers.
    fake.identified = true;
    const { resetIdentity } = await freshClient();

    resetIdentity();
    await flush();

    expect(fake.reset).toHaveBeenCalledTimes(1);
  });

  it("leaves an anonymous visitor's id alone", async () => {
    const { resetIdentity } = await freshClient();

    resetIdentity();
    await flush();

    expect(fake.reset).not.toHaveBeenCalled();
  });

  it("resets once after identifyUser, and person properties stop landing", async () => {
    const { identifyUser, resetIdentity, setPersonProps } = await freshClient();

    identifyUser("user-1", { role: "USER" });
    await flush();
    expect(fake.identify).toHaveBeenCalledWith("user-1", { role: "USER" });

    resetIdentity();
    await flush();
    expect(fake.reset).toHaveBeenCalledTimes(1);

    setPersonProps({ wallet_address: `G${"B".repeat(55)}` });
    await flush();
    expect(fake.setPersonProperties).not.toHaveBeenCalled();
  });

  it("is a no-op without a PostHog key", async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    fake.identified = true;
    const { resetIdentity } = await freshClient();

    resetIdentity();
    await flush();

    expect(fake.init).not.toHaveBeenCalled();
    expect(fake.reset).not.toHaveBeenCalled();
  });
});

const accountA = "00000000-0000-0000-0000-000000000001";
const accountB = "00000000-0000-0000-0000-000000000002";
function contextFor(account: string | null, audience = "UNCLASSIFIED") {
  return {
    account_id: account ?? "",
    caller_type: account ? "session" : "wallet",
    audience,
    stellar_network: "testnet",
    app_env: "local",
    app_version: "dev",
    app_host: "localhost",
    tracking_version: "usage-v2",
  };
}
describe("queued event attribution", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fake.identified = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });
  it("resets a persisted identified browser when synchronization resolves anonymous", async () => {
    fake.identified = true;
    const client = await freshClient();
    client.setAnalyticsSubject(null);
    await client.synchronizeAnalytics(null, {}, contextFor(null), () => true);
    expect(fake.reset).toHaveBeenCalledTimes(1);
    expect(fake.identify).not.toHaveBeenCalled();
  });
  it("drops A's queued action across logout and B login while retaining B's action", async () => {
    const client = await freshClient();
    client.setAnalyticsSubject(accountA);
    client.track("node_added", { node_type: "split" });
    await flush();
    // A's context fetch is delayed; session changes before it returns.
    client.setAnalyticsSubject(null);
    client.setAnalyticsSubject(accountB);
    client.track("node_added", { node_type: "pay" });
    await client.synchronizeAnalytics(accountA, {}, contextFor(accountA, "INTERNAL"), () => true);
    expect(fake.identify).not.toHaveBeenCalled();
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB, "EXTERNAL"), () => true);
    expect(fake.identify).toHaveBeenCalledWith(accountB, {});
    expect(fake.capture.mock.calls).toEqual([["node_added", { node_type: "pay" }]]);
  });
  it("retains queued actions while refreshing the same account's context", async () => {
    const client = await freshClient();
    client.setAnalyticsSubject(accountA);
    client.track("node_added", { node_type: "split" });
    client.setAnalyticsContext(null);
    client.setAnalyticsSubject(accountA);
    await client.synchronizeAnalytics(accountA, {}, contextFor(accountA, "INTERNAL"), () => true);
    expect(fake.capture).toHaveBeenCalledWith("node_added", { node_type: "split" });
  });
  it("drops events whose originating session is unknown rather than assigning them later", async () => {
    const client = await freshClient();
    client.track("node_added", { node_type: "split" });
    client.setAnalyticsSubject(accountB);
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB, "EXTERNAL"), () => true);
    expect(fake.capture).not.toHaveBeenCalled();
  });
  it("invalidates delayed SDK initialization and stale callbacks across identity changes", async () => {
    const client = await freshClient();
    client.setAnalyticsSubject(accountA);
    client.track("node_added", { node_type: "split" });
    const oldSync = client.synchronizeAnalytics(
      accountA,
      {},
      contextFor(accountA, "INTERNAL"),
      () => true,
    );
    client.setAnalyticsSubject(null);
    client.setAnalyticsSubject(accountB);
    await oldSync;
    expect(fake.identify).not.toHaveBeenCalled();
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB, "EXTERNAL"), () => true);
    expect(fake.capture).not.toHaveBeenCalled();
    expect(fake.identify).toHaveBeenCalledWith(accountB, {});
  });
  it("routes the SDK final hook through full-envelope sanitization", async () => {
    const client = await freshClient();
    client.setAnalyticsSubject(accountB);
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB, "EXTERNAL"), () => true);
    const config = fake.init.mock.calls[0]?.[1] as
      | { before_send: (event: unknown) => unknown }
      | undefined;
    const result = config?.before_send({
      event: "$identify",
      uuid: "sdk-id",
      properties: { distinct_id: accountB, token: "PRIVATE" },
      $set: { role: "USER", username: "PRIVATE" },
      $set_once: { $current_url: "https://example.com/?ticket=PRIVATE" },
      $unset: ["role", "PRIVATE"],
      unexpected: { deep: "PRIVATE" },
    });
    expect(result).toMatchObject({
      $set: { role: "USER" },
      $set_once: {},
      $unset: ["role"],
      properties: { $process_person_profile: true, token: "phc_test" },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("independent root-error diagnostics", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { pathname: "/dashboard" } });
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fake.identified = false;
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });
  function responseFor(account: string | null) {
    return new Response(JSON.stringify({ data: { ...contextFor(account), subject_id: account } }));
  }
  it.each([null, accountA])(
    "initial global-error synchronizes and captures its diagnostic for %s",
    async (account) => {
      // No AnalyticsProvider mounted: the root layout failed on its initial render.
      fake.identified = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => responseFor(account)),
      );
      const client = await freshClient();
      client.track("node_added", { node_type: "split" });
      const error = new Error("PRIVATE full error message");
      error.stack = "PRIVATE unrestricted stack\n /_next/static/chunks/safe.js:1:2";
      client.trackException(error, "render");
      await flush();
      expect(fetch).toHaveBeenCalledWith("/api/audit/analytics-context");
      expect(fake.reset).toHaveBeenCalledTimes(1);
      if (account) expect(fake.identify).toHaveBeenCalledWith(account, {});
      else expect(fake.identify).not.toHaveBeenCalled();
      expect(fake.capture.mock.calls).toEqual([
        [
          "exception_captured",
          {
            stage: "render",
            error_class: "unknown",
            error_code: null,
            frames: ["/_next/static/chunks/safe.js:1:2"],
          },
        ],
      ]);
      const config = fake.init.mock.calls[0]?.[1] as unknown as {
        before_send: (event: unknown) => unknown;
      };
      expect(
        config.before_send({
          event: "exception_captured",
          uuid: "id",
          properties: fake.capture.mock.calls[0]?.[1],
        }),
      ).toMatchObject({
        properties: { account_id: account ?? "", stage: "render" },
      });
      expect(JSON.stringify(fake.capture.mock.calls)).not.toContain("PRIVATE");
    },
  );
  it("drops a stale fallback when identity changes during the context fetch", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const client = await freshClient();
    client.trackException(new Error("render"), "render");
    client.setAnalyticsSubject(accountB);
    resolveFetch(responseFor(accountA));
    await flush();
    expect(fake.identify).not.toHaveBeenCalled();
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB), () => true);
    expect(fake.identify).toHaveBeenCalledWith(accountB, {});
    expect(fake.capture).not.toHaveBeenCalled();
  });
  it("drops a stale fallback when identity changes while parsing the response", async () => {
    let resolveBody!: (body: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: () =>
          new Promise<unknown>((resolve) => {
            resolveBody = resolve;
          }),
      })),
    );
    const client = await freshClient();
    client.trackException(new Error("render"), "render");
    await flush();
    client.setAnalyticsSubject(accountB);
    resolveBody({ data: { ...contextFor(accountA), subject_id: accountA } });
    await flush();
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB), () => true);
    expect(fake.identify.mock.calls).toEqual([[accountB, {}]]);
    expect(fake.capture).not.toHaveBeenCalled();
  });
  it("invalidates owned initial adoption before delayed SDK initialization finishes", async () => {
    const client = await freshClient();
    // Let the synchronous json() body adopt A before loadAnalytics imports settle.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { ...contextFor(accountA), subject_id: accountA } }),
      })),
    );
    client.trackException(new Error("render"), "render");
    await Promise.resolve();
    await Promise.resolve();
    client.setAnalyticsSubject(accountB);
    await flush();
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB), () => true);
    expect(fake.identify.mock.calls).toEqual([[accountB, {}]]);
    expect(fake.capture).not.toHaveBeenCalled();
  });
  it("captures a known account's queued diagnostic once without replaying it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responseFor(accountA)),
    );
    const client = await freshClient();
    client.setAnalyticsSubject(accountA);
    client.trackException(new Error("render"), "render");
    await flush();
    expect(fake.capture).toHaveBeenCalledTimes(1);
    expect(fake.capture.mock.calls[0]?.[0]).toBe("exception_captured");
  });
  it("does not establish identity from an inconsistent server context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { ...contextFor(accountB), subject_id: accountA } })),
      ),
    );
    const client = await freshClient();
    client.trackException(new Error("render"), "render");
    await flush();
    client.track("node_added", { node_type: "pay" });
    client.setAnalyticsSubject(accountB);
    await client.synchronizeAnalytics(accountB, {}, contextFor(accountB), () => true);
    expect(fake.identify.mock.calls).toEqual([[accountB, {}]]);
    expect(fake.capture).not.toHaveBeenCalled();
  });
});
