/**
 * The yield crate implements receive_and_forward only. The deposit trigger,
 * payer, splitter, swapper, timelock and router all call execute_step on their
 * next steps, so a yield behind any of them deploys and then reverts on the
 * first run; and yield forwards amount = 0 downstream, which every next-step
 * contract rejects. Until #158 gives it an execute_step and a real forward,
 * validateFlow only accepts a yield fed directly by a receive_and_forward
 * trigger with nothing on-chain after it.
 */
import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { validateFlow } from "@/lib/flows/validate";

const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

const yieldNode = { id: "y", type: "yield", config: { asset: USDC, vault: ACCOUNT } };
const pay = {
  id: "p",
  type: "pay",
  config: {
    recipient: OTHER,
    asset: USDC,
    mode: "fixed",
    amountStroops: "1000000",
    fullAmount: true,
  },
};
const email = {
  id: "m",
  type: "email_notify",
  config: { recipients: [{ address: OTHER, email: "a@example.com" }], subject: "Paid", body: "" },
};
const webhook = { id: "t", type: "web2_webhook", config: { asset: USDC } };
const oracle = { id: "t", type: "oracle", config: { asset: USDC, threshold: "100" } };
const onReceive = { id: "t", type: "on_receive", config: { asset: USDC } };

const parentError = (v: ReturnType<typeof validateFlow>) =>
  !v.ok && v.errors.some((e) => /only come straight after/.test(e.friendlyMessage));
const terminalError = (v: ReturnType<typeof validateFlow>) =>
  !v.ok && v.errors.some((e) => /end of the line/.test(e.friendlyMessage));

describe("yield is accepted only where the crate can run", () => {
  it("accepts web2_webhook → yield", () => {
    const v = validateFlow({
      nodes: [webhook, yieldNode],
      edges: [{ id: "e1", source: "t", target: "y" }],
    } as never);
    expect(v.ok, v.ok ? "" : JSON.stringify(v.errors)).toBe(true);
    if (!v.ok) return;
    expect(v.templateKind).toBe(TemplateKind.YIELD);
    expect(v.pipeline).toEqual([TemplateKind.WEBHOOK, TemplateKind.YIELD]);
  });

  it("accepts oracle → yield", () => {
    const v = validateFlow({
      nodes: [oracle, yieldNode],
      edges: [{ id: "e1", source: "t", target: "y" }],
    } as never);
    expect(v.ok, v.ok ? "" : JSON.stringify(v.errors)).toBe(true);
  });

  it("accepts an email notification after a yield", () => {
    const v = validateFlow({
      nodes: [webhook, yieldNode, email],
      edges: [
        { id: "e1", source: "t", target: "y" },
        { id: "e2", source: "y", target: "m" },
      ],
    } as never);
    expect(v.ok, v.ok ? "" : JSON.stringify(v.errors)).toBe(true);
  });

  it("refuses on_receive → yield: the deposit trigger calls execute_step", () => {
    const v = validateFlow({
      nodes: [onReceive, yieldNode],
      edges: [{ id: "e1", source: "t", target: "y" }],
    } as never);
    expect(parentError(v)).toBe(true);
  });

  it("refuses a yield behind a swap: the swapper calls execute_step", () => {
    const swap = {
      id: "s",
      type: "swap",
      config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
    };
    const v = validateFlow({
      nodes: [{ ...onReceive, config: { asset: XLM } }, swap, yieldNode],
      edges: [
        { id: "e1", source: "t", target: "s" },
        { id: "e2", source: "s", target: "y" },
      ],
    } as never);
    expect(parentError(v)).toBe(true);
  });

  it("refuses an on-chain step after a yield: it would be invoked with amount 0", () => {
    const v = validateFlow({
      nodes: [webhook, yieldNode, pay],
      edges: [
        { id: "e1", source: "t", target: "y" },
        { id: "e2", source: "y", target: "p" },
      ],
    } as never);
    expect(terminalError(v)).toBe(true);
  });
});
