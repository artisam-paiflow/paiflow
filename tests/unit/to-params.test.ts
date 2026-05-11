import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { flowToParams } from "@/lib/flows/to-params";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("flowToParams", () => {
  it("produces splitter params", () => {
    const out = flowToParams(
      {
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
                { address: ADDR, bps: 6000 },
                { address: ADDR, bps: 4000 },
              ],
            },
          },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      },
      TemplateKind.SPLITTER,
    );
    expect(out.kind).toBe("splitter");
    if (out.kind === "splitter") {
      expect(out.recipients).toHaveLength(2);
      expect(out.recipients[0]!.bps).toBe(6000);
    }
  });

  it("produces streamer params", () => {
    const out = flowToParams(
      {
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
              amountStroops: "1000",
              asset: { kind: "native" },
            },
          },
        ],
        edges: [{ id: "e", source: "t", target: "a" }],
      },
      TemplateKind.STREAMER,
    );
    expect(out.kind).toBe("streamer");
    if (out.kind === "streamer") {
      expect(out.recipient).toBe(ADDR);
      expect(out.endTs).toBeGreaterThan(out.startTs);
    }
  });
});
