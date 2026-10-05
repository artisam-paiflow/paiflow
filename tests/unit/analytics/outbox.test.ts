import { beforeEach, describe, expect, it, vi } from "vitest";
const { db, deliver } = vi.hoisted(() => ({
  db: { analyticsDelivery: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
  deliver: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/analytics/server", () => ({ deliverAnalytics: deliver }));
import { deliverOutbox } from "@/lib/analytics/outbox";
import { analyticsEventId } from "@/lib/analytics/event-id";
const row = {
  id: analyticsEventId("testnet:confirmed:" + "a".repeat(64)),
  distinctId: "user",
  event: "transaction_outcome",
  properties: { tx_hash: "a".repeat(64) },
  occurredAt: new Date(),
  nextAttemptAt: new Date(),
  personProfile: false,
  attempts: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  db.analyticsDelivery.findMany.mockResolvedValue([row]);
  db.analyticsDelivery.updateMany.mockResolvedValue({ count: 1 });
  db.analyticsDelivery.update.mockResolvedValue({});
});
describe("transactional analytics delivery", () => {
  it("keeps the same insert ID and occurrence time across retries", async () => {
    deliver.mockResolvedValueOnce(false);
    expect(await deliverOutbox()).toMatchObject({ attempted: 1, delivered: 0 });
    expect(db.analyticsDelivery.update.mock.calls[0]?.[0].data).not.toHaveProperty("deliveredAt");
    deliver.mockResolvedValueOnce(true);
    expect(await deliverOutbox()).toMatchObject({ attempted: 1, delivered: 1 });
    expect(deliver.mock.calls[0]?.[0]).toEqual(deliver.mock.calls[1]?.[0]);
    expect(deliver.mock.calls[0]?.[0]).toMatchObject({ id: row.id, occurredAt: row.occurredAt });
  });
  it("skips another process's claim and stops at the budget", async () => {
    db.analyticsDelivery.updateMany.mockResolvedValue({ count: 0 });
    await deliverOutbox();
    expect(deliver).not.toHaveBeenCalled();
    expect(await deliverOutbox({ budgetMs: 0 })).toMatchObject({ attempted: 0, truncated: true });
  });
  it("uses deterministic event UUIDs and separates event/network keys", () => {
    expect(analyticsEventId("testnet:signed:a")).toBe(analyticsEventId("testnet:signed:a"));
    expect(analyticsEventId("mainnet:signed:a")).not.toBe(analyticsEventId("testnet:signed:a"));
    expect(analyticsEventId("testnet:confirmed:a")).not.toBe(analyticsEventId("testnet:signed:a"));
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
