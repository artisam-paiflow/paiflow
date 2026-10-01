import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { errorResponse } from "@/lib/errors";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const { holder, finished, status } = vi.hoisted(() => ({
  holder: { client: null as Redis | null },
  finished: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ redis: () => holder.client }));
vi.mock("@/lib/stellar/payout-state", () => ({
  payoutTransactionFinished: finished,
  payoutTransactionStatus: status,
}));
import {
  acquirePayoutLease,
  assertPreparedPayout,
  releasePreparedPayout,
} from "@/lib/api/v1/payout-lease";

const client = new Redis("redis://127.0.0.1:6379", { lazyConnect: true, maxRetriesPerRequest: 1 });
const leases: Array<Awaited<ReturnType<typeof acquirePayoutLease>>> = [];
let id = "";
const tx = { txHash: "a".repeat(64), maxTime: "2000000000" };
const key = () => `v1:payout:${id}`;
async function acquire(token = "token") {
  const l = await acquirePayoutLease(id, token);
  leases.push(l);
  return l;
}
async function expireOwner() {
  const r = JSON.parse((await client.get(key()))!) as { ownerExpires: number };
  r.ownerExpires = Date.now() - 1;
  await client.set(key(), JSON.stringify(r));
}
beforeAll(async () => {
  await client.connect();
});
afterAll(async () => {
  await client.quit();
});
beforeEach(() => {
  id = randomUUID();
  holder.client = client;
  finished.mockReset().mockResolvedValue(false);
  status.mockReset().mockResolvedValue({ status: "SUCCESS" });
});
afterEach(async () => {
  holder.client = client;
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const l of leases.splice(0)) await l.close();
  const keys = await client.keys(`v1:payout:${id}*`);
  if (keys.length) await client.del(...keys);
});

describe("payout ownership on real Redis Lua", () => {
  it("fails closed without ready Redis", async () => {
    holder.client = null;
    await expect(acquire()).rejects.toThrow(/functioning Redis/);
  });
  it("allows exactly one concurrent preparation", async () => {
    const results = await Promise.allSettled([acquire("a"), acquire("b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await client.ttl(key())).toBe(-1);
  });
  it("renews preparation and stops renewal after close", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const initial = Date.now();
    const date = vi.spyOn(Date, "now").mockReturnValue(initial);
    const l = await acquire();
    date.mockReturnValue(initial + 30000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.waitFor(async () =>
      expect(JSON.parse((await client.get(key()))!).ownerExpires).toBe(initial + 75000),
    );
    await l.close();
    await vi.advanceTimersByTimeAsync(30000);
    expect(await client.get(key())).toBeNull();
  });
  it("stale holders cannot mutate, return XDR or release a successor", async () => {
    const old = await acquire();
    await expireOwner();
    const next = await acquire("next");
    await expect(old.assertOwnership()).rejects.toThrow(/Another payout/);
    await expect(old.checkpointConfiguration(tx)).rejects.toThrow(/Another payout/);
    await expect(old.ready(tx)).rejects.toThrow(/Another payout/);
    await old.close();
    expect(JSON.parse((await client.get(key()))!).owner).toBe(next.record.owner);
  });
  it("keeps an uncertain configuration after a crash until ledger finality/expiry is proved", async () => {
    const l = await acquire();
    await l.checkpointConfiguration(tx);
    await l.close();
    await expireOwner();
    await expect(acquire("next")).rejects.toThrow(/Another payout/);
    expect(finished).toHaveBeenCalledWith(tx);
    finished.mockResolvedValue(true);
    const next = await acquire("next");
    expect(next.record.owner).not.toBe(l.record.owner);
  });
  it("does not treat RPC errors as transaction finality", async () => {
    const l = await acquire();
    await l.checkpointConfiguration(tx);
    await expireOwner();
    finished.mockRejectedValue(new Error("RPC down"));
    await expect(acquire()).rejects.toThrow(/RPC down/);
    expect(await client.get(key())).not.toBeNull();
  });
  it("clears a confirmed configuration and safely releases failed preparation", async () => {
    const l = await acquire();
    await l.checkpointConfiguration(tx);
    await l.configurationFinal();
    await l.close();
    expect(await client.get(key())).toBeNull();
  });
  it("retains a returned deposit beyond wall-clock owner expiry", async () => {
    const l = await acquire();
    await l.ready(tx);
    await l.close();
    await expireOwner();
    await expect(acquire()).rejects.toThrow(/Another payout/);
    expect(await client.ttl(key())).toBe(-1);
    expect(await client.ttl(`${key()}:tx:${tx.txHash}`)).toBeGreaterThan(604000);
  });
  it.each(["configuration", "deposit"] as const)(
    "reports Retry-After from the held %s maxTime without weakening protection",
    async (stage) => {
      const now = 2000000000000;
      vi.spyOn(Date, "now").mockReturnValue(now);
      const l = await acquire();
      const held = { ...tx, maxTime: String(now / 1000 + 60) };
      if (stage === "deposit") await l.ready(held);
      else await l.checkpointConfiguration(held);
      await l.close();
      await expireOwner();
      for (const [elapsed, retryAfter] of [
        [0, "60"],
        [1500, "59"],
        [61000, "1"],
      ] as const) {
        vi.spyOn(Date, "now").mockReturnValue(now + elapsed);
        let failure: unknown;
        try {
          await acquire("next");
        } catch (err) {
          failure = err;
        }
        const response = errorResponse(failure);
        expect(response.status).toBe(409);
        expect(response.headers.get("Retry-After")).toBe(retryAfter);
        expect(await response.json()).toMatchObject({ error: { code: "CONFLICT" } });
        expect(JSON.parse((await client.get(key()))!).owner).toBe(l.record.owner);
      }
      expect(finished).toHaveBeenCalledWith(held);
      finished.mockResolvedValue(true);
      expect((await acquire("next")).record.owner).not.toBe(l.record.owner);
    },
  );
  it("binds the exact hash to both deployment and token", async () => {
    const l = await acquire();
    await l.ready(tx);
    expect((await assertPreparedPayout(id, "token", tx.txHash)).allowSubmit).toBe(true);
    await expect(assertPreparedPayout(id, "other", tx.txHash)).rejects.toThrow(/does not match/);
    await expect(assertPreparedPayout("other", "token", tx.txHash)).rejects.toThrow(/not prepared/);
    await expect(assertPreparedPayout(id, "token", "b".repeat(64))).rejects.toThrow(/not prepared/);
  });
  it("final retries cannot release a newer payout", async () => {
    const old = await acquire();
    await old.ready(tx);
    const binding = await assertPreparedPayout(id, "token", tx.txHash);
    finished.mockResolvedValue(true);
    const next = await acquire("next");
    expect((await assertPreparedPayout(id, "token", tx.txHash)).allowSubmit).toBe(false);
    await releasePreparedPayout(binding.record);
    expect(JSON.parse((await client.get(key()))!).owner).toBe(next.record.owner);
  });
  it("refuses expired unconfirmed retries once a successor holds protection", async () => {
    const old = await acquire();
    await old.ready(tx);
    finished.mockResolvedValue(true);
    await acquire("next");
    status.mockResolvedValue({ status: "NOT_FOUND" });
    await expect(assertPreparedPayout(id, "token", tx.txHash)).rejects.toThrow(/expired/);
  });
  it("Redis errors keep the configuration checkpoint intact", async () => {
    const l = await acquire();
    await l.checkpointConfiguration(tx);
    vi.spyOn(client, "eval").mockRejectedValueOnce(new Error("disconnected"));
    await expect(l.assertOwnership()).rejects.toThrow(/functioning Redis/);
    expect(JSON.parse((await client.get(key()))!).configTx).toEqual(tx);
  });
});
