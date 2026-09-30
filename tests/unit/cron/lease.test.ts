import { beforeEach, describe, expect, it, vi } from "vitest";

/** Just enough of ioredis for `SET key id PX ttl NX` and the compare-and-delete script. */
const { store, fake, holder } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const fake = {
    set: vi.fn(async (key: string, value: string, ..._rest: Array<string | number>) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    eval: vi.fn(async (_script: string, _n: number, key: string, id: string) => {
      if (store.get(key) !== id) return 0;
      store.delete(key);
      return 1;
    }),
  };
  return { store, fake, holder: { client: fake as typeof fake | null } };
});
vi.mock("@/lib/redis", () => ({ redis: () => holder.client }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));

import { withCronLease, resetCronLeaseWarningForTests } from "@/lib/cron/lease";
import { cronDeadline } from "@/lib/cron/deadline";

beforeEach(() => {
  store.clear();
  fake.set.mockClear();
  fake.eval.mockClear();
  holder.client = fake;
  resetCronLeaseWarningForTests();
});

describe("withCronLease", () => {
  it("takes cron:<name> with NX and a TTL, and releases it after success", async () => {
    const result = await withCronLease("demo", 5_000, async () => {
      expect(store.has("cron:demo")).toBe(true);
      return 42;
    });
    expect(result).toEqual({ acquired: true, value: 42 });
    expect(fake.set).toHaveBeenCalledWith("cron:demo", expect.any(String), "PX", 5_000, "NX");
    expect(store.has("cron:demo")).toBe(false);
  });

  it("releases the lease when the run throws, and rethrows", async () => {
    await expect(
      withCronLease("demo", 5_000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(store.has("cron:demo")).toBe(false);
  });

  it("a second concurrent invocation is not acquired and never runs its body", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const body = vi.fn();
    const first = withCronLease("demo", 5_000, () => gate);
    await vi.waitFor(() => expect(store.has("cron:demo")).toBe(true));

    const second = await withCronLease("demo", 5_000, async () => body());
    expect(second).toEqual({ acquired: false });
    expect(body).not.toHaveBeenCalled();
    // The loser did not release the winner's lease.
    expect(store.has("cron:demo")).toBe(true);

    release();
    await first;
    expect(store.has("cron:demo")).toBe(false);
  });

  it("leases are per cron name", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = withCronLease("a", 5_000, () => gate);
    await vi.waitFor(() => expect(store.has("cron:a")).toBe(true));
    expect(await withCronLease("b", 5_000, async () => 1)).toEqual({ acquired: true, value: 1 });
    release();
    await first;
  });

  it("a run that lost its lease does not release the newer run's lease", async () => {
    const result = await withCronLease("demo", 5_000, async () => {
      // The TTL lapsed mid-run and the next tick took the key.
      store.set("cron:demo", "someone-elses-id");
      return "done";
    });
    expect(result).toEqual({ acquired: true, value: "done" });
    expect(store.get("cron:demo")).toBe("someone-elses-id");
  });

  it("runs without a lease when Redis is not configured", async () => {
    holder.client = null;
    const body = vi.fn(async () => "ran");
    expect(await withCronLease("demo", 5_000, body)).toEqual({ acquired: true, value: "ran" });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("runs without a lease when Redis errors on acquire", async () => {
    fake.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const body = vi.fn(async () => "ran");
    expect(await withCronLease("demo", 5_000, body)).toEqual({ acquired: true, value: "ran" });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("keeps the run's result when Redis errors on release", async () => {
    fake.eval.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await withCronLease("demo", 5_000, async () => "ok")).toEqual({
      acquired: true,
      value: "ok",
    });
  });
});

describe("cronDeadline", () => {
  it("expires once the budget has elapsed", () => {
    let t = 1_000;
    const deadline = cronDeadline(500, () => t);
    expect(deadline.expired()).toBe(false);
    t = 1_499;
    expect(deadline.expired()).toBe(false);
    t = 1_500;
    expect(deadline.expired()).toBe(true);
  });

  it("a zero budget is expired immediately", () => {
    expect(cronDeadline(0).expired()).toBe(true);
  });
});
