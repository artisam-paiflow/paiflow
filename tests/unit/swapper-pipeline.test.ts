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

  it("rejects a deadline past the u64 the constructor serializes", () => {
    const parse = (deadlineSecs: number) =>
      FlowGraphSchema.safeParse({
        nodes: [{ id: "s", type: "swap", config: { assetIn: XLM, assetOut: USDC, deadlineSecs } }],
        edges: [],
      }).success;
    // `.int()` accepts any integer-valued float, so without an upper bound 1e20
    // reaches scval.ts and makes nativeToScVal throw a plain Error, surfacing
    // from /api/deployments/prepare as a 500 rather than a 422 field error.
    expect(parse(1e20)).toBe(false);
    expect(parse(86_401)).toBe(false);
    expect(parse(86_400)).toBe(true);
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

  it("refuses on_receive → yield until the yield crate has an execute_step", () => {
    // The deposit trigger calls execute_step on its next steps; the yield
    // contract only implements receive_and_forward, so this shape would deploy
    // and then revert on the first deposit. See the yield guard in validate.ts.
    const r = validateFlow({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        { id: "y", type: "yield", config: { asset: USDC, vault: RECIPIENT } },
      ],
      edges: [{ id: "e1", source: "t", target: "y" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => /only come straight after/.test(e.friendlyMessage))).toBe(true);
  });

  it("rejects a swap with more than one outgoing edge", () => {
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
      expect(issue?.code).toBe("SWAP_SINGLE_EDGE");
    }
  });

  it("rejects a terminal swap: the output would strand in a contract with no way out", () => {
    const g = swapFlow();
    const r = validateFlow({
      ...g,
      nodes: g.nodes.filter((n) => n.id !== "p"),
      edges: g.edges.filter((e) => e.id !== "e2"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path === "nodes.s");
      expect(issue?.code).toBe("SWAP_NEEDS_NEXT_STEP");
    }
  });

  it("rejects a swap whose only outgoing edge targets an email_notify", () => {
    // The email edge is dropped by getPipelineChildren, so the swapper would be
    // constructed with zero next steps — the same stranding as a terminal swap.
    const g = swapFlow();
    const r = validateFlow({
      ...g,
      nodes: [
        ...g.nodes.filter((n) => n.id !== "p"),
        {
          id: "n",
          type: "email_notify",
          config: { recipients: [{ address: RECIPIENT, email: "a@b.com" }], subject: "Swapped" },
        },
      ],
      edges: [...g.edges.filter((e) => e.id !== "e2"), { id: "e3", source: "s", target: "n" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path === "nodes.s");
      expect(issue?.code).toBe("SWAP_NEEDS_NEXT_STEP");
    }
  });

  it("does not count an email_notify edge toward the swap's single next step", () => {
    // getPipelineChildren in to-params.ts drops every edge touching an
    // email_notify node, so this graph still constructs the swapper with
    // exactly one next step.
    const base = swapFlow();
    const r = validateFlow({
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "n",
          type: "email_notify",
          config: { recipients: [{ address: RECIPIENT, email: "a@b.com" }], subject: "Swapped" },
        },
      ],
      edges: [...base.edges, { id: "e3", source: "s", target: "n" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.SWAPPER,
        TemplateKind.PAYER,
      ]);
    }
  });

  it("rejects a swap whose two sides are the same asset", () => {
    // Soroswap has no pair for an asset against itself: without this the flow
    // deploys clean and reverts inside factory.get_pair on the first trigger.
    const base = swapFlow();
    const r = validateFlow({
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === "s" ? { ...n, config: { ...n.config, assetOut: XLM } } : n,
      ),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.errors.find((e) => e.path === "nodes.s.config.assetOut");
      expect(issue?.code).toBe("SWAP_SAME_ASSET");
    }
  });

  it("accepts a dev-mode flow containing a swap", () => {
    const r = validateFlow(swapFlow({ devMode: true }));
    expect(r.ok).toBe(true);
  });

  it("rejects a slippage under the 0.3% pool fee with a message bound to slippageBps", () => {
    // Spot less 0 bps sits above what the router returns once its fee is off,
    // so the swap reverts on every trigger; the schema still parses it so a
    // graph saved before this rule loads, but it must not deploy.
    const withSlippage = (slippageBps: number) => {
      const base = swapFlow();
      return validateFlow({
        ...base,
        nodes: base.nodes.map((n) =>
          n.id === "s" ? { ...n, config: { ...n.config, slippageBps } } : n,
        ),
      });
    };
    for (const bps of [0, 29]) {
      const r = withSlippage(bps);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const issue = r.errors.find((e) => e.path === "nodes.s.config.slippageBps");
        expect(issue?.code).toBe("SWAP_SLIPPAGE_TOO_LOW");
      }
    }
    expect(withSlippage(30).ok).toBe(true);
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

  it("prefers the originating frame when the error escalates through the pipeline", () => {
    // Shape of the real simulate log for a 0 bps swap on testnet (2026-09-06):
    // newest first, so the deposit trigger re-raises the router's 507 before
    // the swapper and the router itself appear.
    const TRIGGER = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";
    const SWAPPER = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
    const entry = (address: string) =>
      `[Diagnostic Event] contract:${address}, topics:[error, Error(Contract, #507)], data:"escalating error to VM trap from failed host function call: call"`;
    const raw =
      "HostError: Error(Contract, #507) Event log (newest first): " +
      `0: ${entry(TRIGGER)} 1: ${entry(SWAPPER)} 2: ${entry(ROUTER)} ` +
      `3: [Diagnostic Event] contract:${ROUTER}, topics:[fn_call, ${PARENT}, get_reserves], data:Void`;
    const t = translateSorobanError(raw, {
      addressMap: {
        [TRIGGER]: "deposit_trigger",
        [SWAPPER]: "swapper",
        [ROUTER]: "soroswap_router",
      },
    });
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("RouterInsufficientOutputAmount");
    expect(t.friendly).toMatch(/slippage/i);
  });

  it("does not map a re-raised token error against an intermediate frame's table", () => {
    // A frame traps with the same code its callee raised, so a token contract's
    // #6 (AccountMissing) on the pay leg reaches the swapper's frame as #6 too.
    // Without the re-raise check that read as the swapper's BadDeadline — a
    // confidently wrong message where develop showed the numbered fallback.
    const TRIGGER = "CCH3TIPZCI35FM3BOOBQA4JLLTU6KYOPQEFKWQMYMR5P2J47G3BZDWWN";
    const SWAPPER = "CDLLYSUI3U4BZBQXQJENHZUHTO4PQ2X54LSVSPQ3SQXC6RAGJYIKGKV6";
    const SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const entry = (address: string, code: number) =>
      `[Diagnostic Event] contract:${address}, topics:[error, Error(Contract, #${code})], data:"escalating error to VM trap from failed host function call: call"`;
    const raw =
      "HostError: Error(Contract, #6) Event log (newest first): " +
      `0: ${entry(TRIGGER, 6)} 1: ${entry(SWAPPER, 6)} 2: ${entry(NEXT, 6)} 3: ${entry(SAC, 6)}`;
    const t = translateSorobanError(raw, {
      addressMap: { [TRIGGER]: "deposit_trigger", [SWAPPER]: "swapper", [NEXT]: "payer" },
    });
    expect(t.matched).toBe(false);
    expect(t.friendly).toMatch(/error #6/);

    // A frame that raises a *different* code is a genuine originator and is
    // still translated: here the swapper turns an inner #6 into its own #4.
    const converted =
      "HostError: Error(Contract, #4) Event log (newest first): " +
      `0: ${entry(TRIGGER, 4)} 1: ${entry(SWAPPER, 4)} 2: ${entry(NEXT, 6)} 3: ${entry(SAC, 6)}`;
    const c = translateSorobanError(converted, {
      addressMap: { [TRIGGER]: "deposit_trigger", [SWAPPER]: "swapper", [NEXT]: "payer" },
    });
    expect(c.errorName).toBe("InsufficientOutput");
  });

  it("maps the swapper's own codes", () => {
    const t = translateSorobanError(dump(PARENT, 7), { addressMap: { [PARENT]: "swapper" } });
    expect(t.errorName).toBe("TooManyNextSteps");

    const none = translateSorobanError(dump(PARENT, 8), { addressMap: { [PARENT]: "swapper" } });
    expect(none.errorName).toBe("NoNextStep");
    expect(none.friendly).toMatch(/needs a next step/i);
  });

  it("maps a missing pool to the factory's frame, not a bare error code", () => {
    // do_swap resolves the pair through the factory before it touches the
    // router, so a missing pool fails with FactoryError::PairDoesNotExist (205)
    // in the factory's frame. Without the factory in the map the walk finds no
    // table for it and the user sees "error #205".
    const FACTORY = "CDGXPBJPUBLIB4IMEIJXWUJXBLHVK6X33UAHIVLXPHMEGYCHZWLYBLQY";
    const raw = dump(FACTORY, 205);
    expect(
      translateSorobanError(raw, { addressMap: { [ROUTER]: "soroswap_router" } }).matched,
    ).toBe(false);

    const t = translateSorobanError(raw, {
      addressMap: { [ROUTER]: "soroswap_router", [FACTORY]: "soroswap_factory" },
    });
    expect(t.matched).toBe(true);
    expect(t.errorName).toBe("PairDoesNotExist");
    expect(t.friendly).toMatch(/no liquidity pool/i);
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
    return await import("@/lib/env");
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
