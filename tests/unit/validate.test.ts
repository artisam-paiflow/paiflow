import { describe, expect, it } from "vitest";
import { validateFlow } from "@/lib/flows/validate";
import { TemplateKind } from "@prisma/client";

const ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("validateFlow", () => {
  it("accepts an on_receive → split flow as SPLITTER", () => {
    const r = validateFlow({
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
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.templateKind).toBe(TemplateKind.SPLITTER);
  });

  it("rejects bps that don't sum to 10000", () => {
    const r = validateFlow({
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
              { address: ADDR, bps: 3000 },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects flows with no trigger", () => {
    const r = validateFlow({
      nodes: [
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
        {
          id: "b",
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
      edges: [{ id: "e1", source: "a", target: "b" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects flows with cycles", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "native" } },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR, bps: 5000 },
              { address: ADDR, bps: 5000 },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "t" },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unreachable actions", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            amountStroops: "10",
            asset: { kind: "native" },
          },
        },
      ],
      edges: [],
    });
    expect(r.ok).toBe(false);
  });

  it("infers STREAMER from on_schedule → pay", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            interval: "hour",
            startsAt: "2030-01-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          type: "pay",
          config: {
            recipient: ADDR,
            amountStroops: "100",
            asset: { kind: "known", symbol: "USDC" },
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.templateKind).toBe(TemplateKind.STREAMER);
  });

  it("accepts multiple triggers (relaxed validation)", () => {
    const r = validateFlow({
      nodes: [
        { id: "t1", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "t2",
          type: "on_schedule",
          config: { interval: "day", startsAt: "2030-01-01T00:00:00.000Z" },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: ADDR, bps: 5000 },
              { address: ADDR, bps: 5000 },
            ],
          },
        },
      ],
      edges: [
        { id: "e1", source: "t1", target: "a" },
        { id: "e2", source: "t2", target: "a" },
      ],
    });
    expect(r.ok).toBe(true);
  });
});
