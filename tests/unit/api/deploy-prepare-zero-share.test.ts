/**
 * #583: the shape schema now lets a 0 share save, so the deploy route is what
 * must keep it off the chain — through validateFlow, with a field error.
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

import { POST } from "@/app/api/deployments/prepare/route";
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ADDR_C = "GD6JP6TEQEWT3623BTELMLADR2FNBNF6AY62ZCT7T4DGBCPXPMPICVYR";
const USDC = { kind: "known", symbol: "USDC" };

function request() {
  return {
    json: async () => ({ flowId: FLOW_ID, sourceAccount: SOURCE }),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/deployments/prepare with a 0% split share (#583)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses with the share error on the recipients field, even though the sum is 100%", async () => {
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "user-1",
      graph: {
        nodes: [
          { id: "t", type: "on_receive", config: { asset: USDC } },
          {
            id: "s",
            type: "split",
            config: {
              asset: USDC,
              recipients: [
                { address: ADDR_B, mode: "percentage", bps: 10_000 },
                { address: ADDR_C, mode: "percentage", bps: 0, label: "Carol" },
              ],
            },
          },
        ],
        edges: [{ id: "e1", source: "t", target: "s" }],
      },
    });
    const res = await POST(request());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    const [msg] = json.error.fields["nodes.s.config.recipients"];
    expect(msg).toMatch(/share greater than 0%: Carol/);
    expect(preparePipelineDeployTx).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });
});
