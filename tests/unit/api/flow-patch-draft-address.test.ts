/**
 * #588: the builder PATCHes the whole graph on every autosave. A half-typed or
 * cleared address used to fail FlowPatchSchema, so every save 422d and the
 * user's other edits were lost; now it saves, and /deployments/prepare is what
 * refuses it, through validateFlow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    flow: { findFirst: vi.fn(), update: vi.fn() },
    deployment: { create: vi.fn() },
  },
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

import { PATCH } from "@/app/api/flows/[id]/route";
import { POST as PREPARE } from "@/app/api/deployments/prepare/route";
import { preparePipelineDeployTx } from "@/lib/stellar/deploy";

const FLOW_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" };

function splitGraph(second: string) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      {
        id: "s",
        type: "split",
        config: {
          asset: USDC,
          recipients: [
            { address: ADDR_B, mode: "percentage", bps: 5000 },
            { address: second, mode: "percentage", bps: 5000, label: "Carol" },
          ],
        },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "s" }],
  };
}

function jsonRequest(body: unknown) {
  return { json: async () => body } as unknown as import("next/server").NextRequest;
}

const ctx = { params: Promise.resolve({ id: FLOW_ID }) };

describe("PATCH /api/flows/:id with a draft address (#588)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "user-1",
      name: "f",
      description: null,
      graph: splitGraph(SOURCE),
      parameters: {},
      templateKind: "SPLITTER",
    });
    mockDb.flow.update.mockImplementation(async ({ data }) => ({ id: FLOW_ID, ...data }));
  });

  it.each(["", "GAB", SOURCE.toLowerCase()])(
    "saves the graph with %j in a recipient, byte for byte",
    async (draft) => {
      const graph = splitGraph(draft);
      const res = await PATCH(jsonRequest({ graph }), ctx);
      expect(res.status).toBe(200);
      const saved = mockDb.flow.update.mock.calls[0]![0].data.graph;
      expect(saved.nodes[1].config.recipients[1].address).toBe(draft);
      // The last valid pipeline is kept; an invalid graph never replaces it.
      expect(mockDb.flow.update.mock.calls[0]![0].data.parameters).toEqual({});
    },
  );
});

describe("PATCH /api/flows/:id with a secret seed in an address (#588)", () => {
  it("is refused and never written", async () => {
    vi.clearAllMocks();
    mockDb.flow.findFirst.mockResolvedValue({ id: FLOW_ID, ownerId: "user-1", graph: {} });
    const seed = Keypair.random().secret();
    const res = await PATCH(jsonRequest({ graph: splitGraph(seed) }), ctx);
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toContain(seed);
    expect(mockDb.flow.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/deployments/prepare with a draft address (#588)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "",
    "GAB",
    SOURCE.slice(0, 55),
    SOURCE.toLowerCase(),
    // A valid muxed (M…) account: never accepted, before or after #588.
    "MBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLEAAAAAAAAAAAFJN3W",
  ])("refuses %j with an error on the recipient's address field", async (draft) => {
    mockDb.flow.findFirst.mockResolvedValue({
      id: FLOW_ID,
      ownerId: "user-1",
      graph: splitGraph(draft),
    });
    const res = await PREPARE(jsonRequest({ flowId: FLOW_ID, sourceAccount: SOURCE }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION");
    const [msg] = json.error.fields["nodes.s.config.recipients.1.address"];
    expect(msg).toMatch(/split recipient "Carol"/);
    expect(preparePipelineDeployTx).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
  });
});
