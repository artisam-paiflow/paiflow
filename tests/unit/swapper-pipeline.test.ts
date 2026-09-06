/**
 * Instawards D1 (#388): the router-backed swapper through the TypeScript
 * pipeline — schema defaults, validation rules, template kinds, constructor
 * serialization, env helper and error mapping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { TemplateKind } from "@prisma/client";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { translateSorobanError } from "@/lib/stellar/soroban-errors";

vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: vi.fn(() => "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
}));

const ADMIN = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const PARENT = "CDEEJZG6DYN65DTZLS6WU7YJ3I4RJ4TSOHF5VXEFO7PTTHWRNREPDOOU";
const NEXT = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";

const XLM = { kind: "native" } as const;
const USDC = { kind: "known", symbol: "USDC" } as const;

function swapFlow(
  extra: { devMode?: boolean; edges?: { id: string; source: string; target: string }[] } = {},
) {
  return {
    devMode: extra.devMode,
    nodes: [
      { id: "t", type: "on_receive", config: { asset: XLM } },
      {
        id: "s",
        type: "swap",
        config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
      },
      {
        id: "p",
        type: "pay",
        config: {
          recipient: RECIPIENT,
          asset: USDC,
          mode: "fixed",
          amountStroops: "1000000",
          fullAmount: true,
        },
      },
    ],
    edges: extra.edges ?? [
      { id: "e1", source: "t", target: "s" },
      { id: "e2", source: "s", target: "p" },
    ],
  };
}

describe("schema", () => {
  it("defaults slippageBps to 100 and deadlineSecs to 300 so older graphs still parse", () => {
    const parsed = FlowGraphSchema.parse({
      nodes: [{ id: "s", type: "swap", config: { assetIn: XLM, assetOut: USDC } }],
      edges: [],
    });
    const swap = parsed.nodes[0]!;
    expect(swap.type).toBe("swap");
    if (swap.type === "swap") {
      expect(swap.config.slippageBps).toBe(100);
      expect(swap.config.deadlineSecs).toBe(300);
    }
  });

  it("rejects slippage above 100% and a zero deadline", () => {
    const bad = (config: Record<string, unknown>) =>
      FlowGraphSchema.safeParse({ nodes: [{ id: "s", type: "swap", config }], edges: [] }).success;
    expect(bad({ assetIn: XLM, assetOut: USDC, slippageBps: 10_001 })).toBe(false);
    expect(bad({ assetIn: XLM, assetOut: USDC, deadlineSecs: 0 })).toBe(false);
    expect(bad({ assetIn: XLM, assetOut: USDC, slippageBps: -1 })).toBe(false);
  });
});

describe("validateFlow", () => {
  it("labels on_receive → swap → pay as SWAPPER, not SPLITTER", () => {
    const r = validateFlow(swapFlow());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.templateKind).toBe(TemplateKind.SWAPPER);
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.SWAPPER,
        TemplateKind.PAYER,
      ]);
    }
  });

  it("labels on_receive → yield as YIELD", () => {
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        { id: "y", type: "yield", config: { asset: USDC, vault: RECIPIENT } },
      ],
      edges: [{ id: "e1", source: "t", target: "y" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.templateKind).toBe(TemplateKind.YIELD);
  });

  it("rejects a swap with more than one outgoing edge with a friendly message", () => {
    const g = swapFlow();
    g.nodes.push({
      id: "p2",
      type: "pay",
      config: {
        recipient: ADMIN,
        asset: USDC,
        mode: "fixed",
        amountStroops: "1000000",
        fullAmount: true,
      },
    });
    g.edges.push({ id: "e3", source: "s", target: "p2" });
    const r = validateFlow(g);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path === "nodes.s");
      expect(issue?.friendlyMessage).toMatch(/one next step/);
    }
  });

  it("accepts a dev-mode flow containing a swap", () => {
    const r = validateFlow(swapFlow({ devMode: true }));
    expect(r.ok).toBe(true);
  });
});

describe("flowToPipeline", () => {
  it("carries slippageBps and deadlineSecs and leaves the router off the graph", () => {
    const g = FlowGraphSchema.parse(swapFlow());
    const node = flowToPipeline(g).find((n) => n.templateKind === TemplateKind.SWAPPER)!;
    expect(node.params).toMatchObject({
      kind: "swapper",
      assetIn: XLM,
      assetOut: USDC,
      slippageBps: 100,
      deadlineSecs: 300,
      nextStepNodeIds: ["p"],
    });
    expect((node.params as { router?: string }).router).toBeUndefined();
  });

  it("keeps the swapper immutable in dev mode while siblings become _DEV", () => {
    const g = FlowGraphSchema.parse(swapFlow({ devMode: true }));
    const kinds = flowToPipeline(g).map((n) => n.templateKind);
    expect(kinds).toContain(TemplateKind.SWAPPER);
    expect(kinds).not.toContain("SWAPPER_DEV");
    expect(kinds).toContain(TemplateKind.PAYER_DEV);
  });
});

describe("pipelineNodeConstructorArgs swapper", () => {
  const params = {
    kind: "swapper" as const,
    assetIn: XLM,
    assetOut: USDC,
    slippageBps: 100,
    deadlineSecs: 300,
    router: ROUTER,
    nextStepNodeIds: ["p"],
  };

  it("emits the eight constructor args in contract order", () => {
    const args = pipelineNodeConstructorArgs(params, ADMIN, PARENT, { p: NEXT });
    expect(args).toHaveLength(8);
    expect(args[0]).toEqual(new Address(ADMIN).toScVal());
    expect(scValToNative(args[3]!)).toBe(100);
    expect(args[4]).toEqual(new Address(ROUTER).toScVal());
    expect(scValToNative(args[5]!)).toBe(300n);
    expect(args[6]).toEqual(new Address(PARENT).toScVal());
    expect(args[7]!.switch()).toBe(xdr.ScValType.scvVec());
    expect(args[7]!.vec()).toHaveLength(1);
  });

  it("refuses to serialize without a router or a parent", () => {
    expect(() =>
      pipelineNodeConstructorArgs({ ...params, router: undefined }, ADMIN, PARENT, { p: NEXT }),
    ).toThrow(/router/);
    expect(() => pipelineNodeConstructorArgs(params, ADMIN, undefined, { p: NEXT })).toThrow(
      /parent/,
    );
  });
});

describe("soroban error mapping", () => {
  const dump = (address: string, code: number) =>
    "HostError: Error(Contract, #" +
    code +
    ") Event log (newest first): 0: [Diagnostic Event] contract:" +
    address +
    ", topics:[error, Error(Contract, #" +
    code +
    ')], data:"escalating error to VM trap from failed host function call: swap_exact_tokens_for_tokens"';

  it("maps a Soroswap router revert to prose through the address map", () => {
    const t = translateSorobanError(dump(ROUTER, 507), {
      addressMap: { [ROUTER]: "soroswap_router" },
    });
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("RouterInsufficientOutputAmount");
    expect(t.friendly).toMatch(/slippage/i);
  });

  it("maps the swapper's own codes", () => {
    const t = translateSorobanError(dump(PARENT, 7), { addressMap: { [PARENT]: "swapper" } });
    expect(t.errorName).toBe("TooManyNextSteps");
  });
});

describe("soroswapRouterAddress", () => {
  const requiredEnv = {
    AUTH_SECRET: "test_auth_secret_at_least_32_chars_long",
    DATABASE_URL: "postgresql://paiflow:paiflow@localhost:5432/paiflow",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  };
  async function loadEnv(network: "testnet" | "mainnet", router?: string) {
    for (const [k, v] of Object.entries(requiredEnv)) process.env[k] = v;
    process.env.STELLAR_NETWORK = network;
    delete process.env.STELLAR_SOROSWAP_ROUTER_TESTNET;
    delete process.env.STELLAR_SOROSWAP_ROUTER_MAINNET;
    if (router !== undefined)
      process.env[`STELLAR_SOROSWAP_ROUTER_${network.toUpperCase()}`] = router;
    vi.resetModules();
    return await import("../../lib/env");
  }
  beforeEach(() => vi.resetModules());

  it("returns the address pinned for the active network, or undefined", async () => {
    expect((await loadEnv("testnet", ROUTER)).soroswapRouterAddress()).toBe(ROUTER);
    expect((await loadEnv("mainnet", ROUTER)).soroswapRouterAddress()).toBe(ROUTER);
    expect((await loadEnv("testnet")).soroswapRouterAddress()).toBeUndefined();
  });

  it("rejects a value that is not a contract address at load time", async () => {
    const mod = await loadEnv("testnet", ADMIN);
    expect(() => mod.soroswapRouterAddress()).toThrow();
  });
});
