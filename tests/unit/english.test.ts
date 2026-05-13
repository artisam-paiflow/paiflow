import { describe, expect, it } from "vitest";
import { flowToEnglish } from "@/lib/flows/english";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("flowToEnglish", () => {
  it("describes a 60/30/10 split", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "known", symbol: "USDC" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "known", symbol: "USDC" },
            recipients: [
              { address: ADDR, bps: 6000, label: "Mom" },
              { address: ADDR, bps: 3000, label: "Landlord" },
              { address: ADDR, bps: 1000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("receives USDC");
    expect(out).toContain("60% to Mom");
    expect(out).toContain("30% to Landlord");
    expect(out).toContain("10% to Savings");
  });

  it("describes a streamer", () => {
    const out = flowToEnglish({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: { interval: "hour", startsAt: "2030-01-01T00:00:00.000Z" },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            amountStroops: "20000000",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(out).toContain("every hour");
    expect(out).toContain("pay 2 XLM");
  });
});
