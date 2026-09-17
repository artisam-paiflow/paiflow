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
