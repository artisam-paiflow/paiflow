/**
 * #722: a surface switched off on the server is refused on its node by
 * validateFlow, and the same graph validates when the switch is on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { validateFlow } from "@/lib/flows/validate";
import {
  ALL_FEATURES_ON,
  FEATURE_GATED_BLOCKS,
  disabledTemplateKinds,
  type FeatureFlags,
  type FeatureSurface,
} from "@/lib/feature-flags";
const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ORACLE = "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4";
const USDC = { kind: "known", symbol: "USDC" } as const;
const XLM = { kind: "native" } as const;
const SENDER_KYC = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  countryOrigin: "Philippines",
  sourceOfFunds: "Compensation",
};
const BANK = { accountName: "Bob", accountNumber: "1234567890", bankCode: "BASECPH" };
const LIMIT_VARS = [
  "NEXT_PUBLIC_SPLITTER_XLM_MIN",
  "NEXT_PUBLIC_SPLITTER_XLM_MAX",
  "NEXT_PUBLIC_SPLITTER_USDC_MIN",
  "NEXT_PUBLIC_SPLITTER_USDC_MAX",
];
beforeAll(() => {
  for (const k of LIMIT_VARS) process.env[k] = "0";
});
afterAll(() => {
  for (const k of LIMIT_VARS) delete process.env[k];
});
function off(surface: FeatureSurface): FeatureFlags {
  return { ...ALL_FEATURES_ON, [surface]: false };
}
const GRAPHS: Record<
  string,
  {
    surface: FeatureSurface;
    node: string;
    graph: unknown;
  }
> = {
  "payroll trigger": {
    surface: "payroll",
    node: "t",
    graph: {
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: { asset: USDC, employer: ADDR_A, intervalAmount: 1, intervalUnit: "week" },
        },
        {
          id: "a",
          type: "split",
          config: {
            asset: USDC,
            recipients: [
              { address: ADDR_A, mode: "fixed", amountStroops: "60000000" },
              { address: ADDR_B, mode: "fixed", amountStroops: "40000000" },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    },
  },
  "fiat split recipient": {
    surface: "offramp",
    node: "a",
    graph: {
      senderKyc: SENDER_KYC,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        {
          id: "a",
          type: "split",
          config: {
            asset: USDC,
            recipients: [
              {
                address: "PENDING:fiat",
                mode: "fixed",
                amountStroops: "10000000",
                payoutMode: "fiat",
                ...BANK,
              },
            ],
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    },
  },
  "fiat pay step": {
    surface: "offramp",
    node: "a",
    graph: {
      senderKyc: SENDER_KYC,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        {
          id: "a",
          type: "pay",
          config: {
            asset: USDC,
            recipient: "PENDING:fiat",
            mode: "fixed",
            amountStroops: "10000000",
            payoutMode: "fiat",
            ...BANK,
          },
        },
      ],
      edges: [{ id: "e1", source: "t", target: "a" }],
    },
  },
  "cash out step": {
    surface: "offramp",
    node: "c",
    graph: {
      senderKyc: SENDER_KYC,
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        {
          id: "a",
          type: "split",
          config: {
            asset: USDC,
            recipients: [{ address: ADDR_A, mode: "fixed", amountStroops: "10000000" }],
          },
        },
        { id: "c", type: "cash_out", config: { asset: USDC, ...BANK } },
      ],
      edges: [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "c" },
      ],
    },
  },
  "oracle_gte condition": {
    surface: "oracleCondition",
    node: "c",
    graph: {
      nodes: [
        { id: "t", type: "on_receive", config: { asset: XLM } },
        {
          id: "c",
          type: "condition",
          config: { kind: "oracle_gte", oracle: ORACLE, key: "XLMUSD", threshold: "100" },
        },
        {
          id: "p",
          type: "pay",
          config: {
            recipient: ADDR_B,
            asset: XLM,
            mode: "fixed",
            amountStroops: "5000000",
            fullAmount: false,
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "p" },
      ],
    },
  },
};
describe("validateFlow with surface switches (#722)", () => {
  for (const [name, { surface, node, graph }] of Object.entries(GRAPHS)) {
    describe(name, () => {
      it("validates when every surface is on, and without the option at all", () => {
        expect(validateFlow(graph, { features: ALL_FEATURES_ON }).ok).toBe(true);
        expect(validateFlow(graph).ok).toBe(true);
      });
      it(`is refused on its node when ${FEATURE_GATED_BLOCKS[surface].envVar} is off`, () => {
        const r = validateFlow(graph, { features: off(surface) });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        const issue = r.errors.find((e) => e.code === "FEATURE_DISABLED");
        expect(issue).toMatchObject({ nodeId: node, path: `nodes.${node}` });
        expect(issue!.friendlyMessage).toMatch(/is turned off on this server\./);
      });
      it("is not touched by another surface being off", () => {
        for (const other of Object.keys(ALL_FEATURES_ON) as FeatureSurface[]) {
          if (other === surface) continue;
          expect(validateFlow(graph, { features: off(other) }).ok).toBe(true);
        }
      });
    });
  }
  it("names payroll in the message a student reads", () => {
    const r = validateFlow(GRAPHS["payroll trigger"]!.graph, { features: off("payroll") });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.friendlyMessage).toBe(
        "Payroll is turned off on this server. Use a Subscription or On Schedule trigger instead.",
      );
    }
  });
  it("drops the sender-KYC rule while the off-ramp is off, since there is no KYC to collect", () => {
    const { senderKyc: _kyc, ...noKyc } = GRAPHS["fiat pay step"]!.graph as Record<string, unknown>;
    const on = validateFlow(noKyc, { features: ALL_FEATURES_ON });
    expect(on.ok).toBe(false);
    if (!on.ok) expect(on.errors.some((e) => e.path === "senderKyc")).toBe(true);
    const r = validateFlow(noKyc, { features: off("offramp") });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === "senderKyc")).toBe(false);
      expect(r.errors[0]!.code).toBe("FEATURE_DISABLED");
    }
  });
  it("puts the switch issue first, ahead of the flow's other issues", () => {
    const graph = {
      nodes: [
        {
          id: "t",
          type: "payroll",
          config: { asset: USDC, employer: ADDR_A, intervalAmount: 1, intervalUnit: "week" },
        },
      ],
      edges: [],
    };
    const r = validateFlow(graph, { features: off("payroll") });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]!.code).toBe("FEATURE_DISABLED");
      expect(r.errors.length).toBeGreaterThan(1);
    }
  });
  it("leaves a graph that fails to parse with its schema errors", () => {
    const r = validateFlow(
      { nodes: [{ id: "x", type: "nope" }], edges: [] },
      {
        features: off("payroll"),
      },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.every((e) => e.code !== "FEATURE_DISABLED")).toBe(true);
  });
  it("maps each switched-off surface to the contract kinds prepare refuses", () => {
    expect(disabledTemplateKinds(ALL_FEATURES_ON)).toEqual([]);
    expect(disabledTemplateKinds(off("offramp"))).toEqual([TemplateKind.CASH_OUT]);
    expect(disabledTemplateKinds(off("oracleCondition"))).toEqual([TemplateKind.CONDITIONAL]);
    expect(disabledTemplateKinds(off("payroll"))).toEqual([TemplateKind.PAYROLL]);
    expect(disabledTemplateKinds(off("aiAssistant"))).toEqual([]);
  });
});
