/**
 * Instawards D1 (#389 edge case): deploying a flow that contains a Swap block
 * while the Soroswap router env var is unset is refused with a plain-English
 * message, not a raw error. It also proves each swapConfigIssues() rule that
 * a config alone can trip is refused here with a field error, not only by
 * validateFlow.
 */
import { TemplateKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: { flow: { findFirst: vi.fn() }, deployment: { create: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn(async () => ({ id: "user-1" })) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/stellar/deploy", () => ({
  preparePipelineDeployTx: vi.fn(),
  checkAccountFunding: vi.fn(),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHashes: vi.fn(async () => new Map()) }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  soroswapRouterAddress: vi.fn(() => undefined as string | undefined),
}));

import { POST } from "@/app/api/deployments/prepare/route";
import { soroswapRouterAddress } from "@/lib/env";
import { getWasmHashes } from "@/lib/stellar/config";
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

const swapGraph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "s",
      type: "swap",
      config: {
        assetIn: { kind: "native" },
        assetOut: { kind: "known", symbol: "USDC" },
        slippageBps: 100,
        deadlineSecs: 300,
      },
    },
    {
      id: "p",
      type: "pay",
      config: {
        recipient: RECIPIENT,
        asset: { kind: "known", symbol: "USDC" },
        mode: "fixed",
        amountStroops: "1000000",
        fullAmount: true,
      },
    },
  ],
  edges: [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ],
};

function request() {
  return {
    json: async () => ({ flowId: FLOW_ID, sourceAccount: SOURCE }),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/deployments/prepare with a swap node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.flow.findFirst.mockResolvedValue({ id: FLOW_ID, ownerId: "user-1", graph: swapGraph });
  });

  it("refuses with a plain-English message while the router env is unset", async () => {
    vi.mocked(soroswapRouterAddress).mockReturnValue(undefined);
    const res = await POST(request());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.message).toMatch(/Soroswap router address/);
    expect(json.error.message).toMatch(/STELLAR_SOROSWAP_ROUTER_TESTNET/);
    expect(json.error.message).not.toMatch(/HostError|undefined/);
  });

  it("gets past the guard once the router is set", async () => {
    vi.mocked(soroswapRouterAddress).mockReturnValue(ROUTER);
    const res = await POST(request());
    const json = await res.json();
    // Assert the route reached the guard and moved on: the next check (WASM
    // hashes, mocked to an empty map) is what fails now. Without naming that
    // failure the test would also pass if the route crashed before the guard.
    expect(soroswapRouterAddress).toHaveBeenCalled();
    expect(json.error?.message ?? "").not.toMatch(/Soroswap router address/);
    expect(json.error?.message ?? "").toMatch(/No WASM uploaded for/);
  });

  it("refuses a swap asset the panel does not offer with a field error, not a 500", async () => {
    // Saved through the API, not the panel: a PENDING: issuer parses under
    // AssetSchema, and without the catalogue rule `new Asset()` throws later.
    const pending = { kind: "custom", code: "PHP", issuer: "PENDING:issuer" };
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "user-1",
      graph: {
        ...swapGraph,
        nodes: swapGraph.nodes.map((n) =>
          n.id === "s"
            ? { ...n, config: { ...n.config, assetOut: pending } }
            : n.id === "p"
              ? { ...n, config: { ...n.config, asset: pending } }
              : n,
        ),
      },
    });
    vi.mocked(soroswapRouterAddress).mockReturnValue(ROUTER);
    const res = await POST(request());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    const [msg] = json.error.fields["nodes.s.config.assetOut"];
    expect(msg).toMatch(/Swaps support/);
  });

  function withSwap(swapConfig: Record<string, unknown>, payAsset?: unknown) {
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "user-1",
      graph: {
        ...swapGraph,
        nodes: swapGraph.nodes.map((n) =>
          n.id === "s"
            ? { ...n, config: { ...n.config, ...swapConfig } }
            : n.id === "p" && payAsset
              ? { ...n, config: { ...n.config, asset: payAsset } }
              : n,
        ),
      },
    });
    vi.mocked(soroswapRouterAddress).mockReturnValue(ROUTER);
    // A full hash map, so a flow that got past validation would reach
    // deployment.create and the "nothing prepared" assertions could fail.
    vi.mocked(getWasmHashes).mockResolvedValueOnce(
      new Map([
        [TemplateKind.DEPOSIT_TRIGGER, "hash-trigger"],
        [TemplateKind.SWAPPER, "hash-swapper"],
        [TemplateKind.PAYER, "hash-payer"],
      ]),
    );
  }

  async function refusedFields() {
    const res = await POST(request());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    expect(preparePipelineDeployTx).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
    return json.error.fields as Record<string, string[]>;
  }

  it("refuses a same-asset swap with a field error on Asset Out, preparing nothing", async () => {
    // Third layer for the same rule swap-rules.test.ts proves parses under the
    // shape schema and is refused by validateFlow.
    const xlm = { kind: "native" };
    withSwap({ assetIn: xlm, assetOut: xlm }, xlm);
    const fields = await refusedFields();
    const [msg] = fields["nodes.s.config.assetOut"] ?? [];
    expect(msg).toMatch(/both sides of this one are XLM/);
  });

  it("refuses a slippage under the pool fee with a field error, preparing nothing", async () => {
    withSwap({ slippageBps: 10 });
    const fields = await refusedFields();
    const [msg] = fields["nodes.s.config.slippageBps"] ?? [];
    expect(msg).toMatch(/at least 0\.3%/);
  });
});
