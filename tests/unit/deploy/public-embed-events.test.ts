import { describe, expect, it } from "vitest";
import { mergePublicEvents, PublicSnapshotSchema } from "@/lib/deployments/public-embed-events";
import { publicPayment } from "@/lib/deployments/public-embed";
const event = (eventId: string, ledger = 1) => ({
  eventId,
  ledger,
  kind: "PAYOUT" as const,
  txHash: "a".repeat(64),
  occurredAt: "2026-10-07T00:00:00Z",
});
describe("public event identity and input", () => {
  it("dedupes replay while retaining distinct same-kind payouts in one transaction", () => {
    expect(mergePublicEvents([event("a")], [event("a"), event("b")]).map((e) => e.eventId)).toEqual(
      ["b", "a"],
    );
  });
  it("keeps stable newest-first order, bounded to 50 events", () => {
    const rows = mergePublicEvents(
      [],
      Array.from({ length: 100 }, (_, i) => event(String(i), i)),
    );
    expect(rows).toHaveLength(50);
    expect(rows[0]?.ledger).toBe(99);
    expect(rows[49]?.ledger).toBe(50);
  });
  it("strips fields outside the client allowlist", () => {
    const parsed = PublicSnapshotSchema.parse({
      events: [{ ...event("a"), webhookSecret: "private", payload: {} }],
    });
    expect(JSON.stringify(parsed)).not.toContain("private");
    expect(parsed.events[0]).not.toHaveProperty("payload");
  });
  it.each([
    { kind: "UNKNOWN" },
    { ledger: -1 },
    { txHash: "bad" },
    { occurredAt: "bad" },
    { amountStroops: "1.5" },
  ])("rejects invalid event %j", (overrides) => {
    expect(
      PublicSnapshotSchema.safeParse({ events: [{ ...event("a"), ...overrides }] }).success,
    ).toBe(false);
  });
});
describe("customer payment eligibility", () => {
  it.each([
    ["DEPOSIT_TRIGGER", "pay"],
    ["WEBHOOK", "fund"],
  ])("supports %s", (templateKind, mode) => {
    expect(
      publicPayment({
        id: "id",
        network: "testnet",
        pipelineSnapshot: [{ templateKind }],
        flow: { templateKind: "FLOW" },
      }),
    ).toEqual({ path: "/trigger/id", mode });
  });
  it.each([
    ["SPLITTER", "pay"],
    ["STREAMER", "fund"],
  ])("supports legacy %s", (templateKind, mode) => {
    expect(publicPayment({ id: "id", network: "mainnet", flow: { templateKind } })).toEqual({
      path: "/trigger/id",
      mode,
    });
  });
  it.each(["SUBSCRIPTION", "PAYROLL", "ORACLE", "SCHEDULER"])(
    "does not advertise %s",
    (templateKind) => {
      expect(
        publicPayment({
          id: "id",
          network: "testnet",
          pipelineSnapshot: [{ templateKind }],
          flow: { templateKind },
        }),
      ).toBeNull();
    },
  );
  it("omits payment for an unknown network or malformed metadata", () => {
    expect(
      publicPayment({ id: "id", network: "unknown", flow: { templateKind: "SPLITTER" } }),
    ).toBeNull();
    expect(publicPayment({ id: "id", network: "testnet", pipelineSnapshot: [{}] })).toBeNull();
  });
  it("does not treat a scheduled pipeline as a legacy standalone splitter", () => {
    expect(
      publicPayment({
        id: "id",
        network: "testnet",
        flow: { templateKind: "SPLITTER" },
        pipelineSnapshot: [{ templateKind: "SCHEDULER" }],
      }),
    ).toBeNull();
  });
});
