/**
 * Instawards D1 (#389 edge case): deploying a flow that contains a Swap block
 * while the Soroswap router env var is unset is refused with a plain-English
 * message, not a raw error.
 */
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

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

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
    vi.mocked(soroswapRouterAddress).mockReturnValue(
      "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
    );
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
    vi.mocked(soroswapRouterAddress).mockReturnValue(
      "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
    );
    const res = await POST(request());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    const [msg] = json.error.fields["nodes.s.config.assetOut"];
    expect(msg).toMatch(/Swaps support/);
  });
});
