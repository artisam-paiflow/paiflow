import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { assetContractId } from "@/lib/stellar/assets";
const { values, balances, read } = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  balances: new Map<string, bigint>(),
  read: vi.fn(),
}));
vi.mock("@/lib/stellar/payout-state", () => ({ readPayoutState: read }));
vi.mock("@/lib/stellar/balance", () => ({
  fetchTokenBalance: vi.fn(
    async ({ holderAddress }: { holderAddress: string }) => balances.get(holderAddress) ?? 0n,
  ),
}));
import { payoutEligibility } from "@/lib/api/v1/payout-eligibility";
const FROM = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const T = StrKey.encodeContract(Buffer.alloc(32, 1));
const P = StrKey.encodeContract(Buffer.alloc(32, 2));
const S = StrKey.encodeContract(Buffer.alloc(32, 3));
const C = StrKey.encodeContract(Buffer.alloc(32, 4));
const Q = StrKey.encodeContract(Buffer.alloc(32, 5));
const asset = { kind: "native" } as const;
const input = { from: FROM, amount: "101", recipient: FROM, nodeId: "p" };
function deployment(): Pick<Deployment, "status" | "graphSnapshot" | "pipelineSnapshot"> {
  return {
    status: "CONFIRMED",
    graphSnapshot: FlowGraphSchema.parse({
      devMode: true,
      nodes: [
        { id: "t", type: "on_receive", config: { asset } },
        {
          id: "p",
          type: "pay",
          config: { asset, recipient: "PENDING:__api__", fillValueViaApi: true },
        },
      ],
      edges: [{ id: "tp", source: "t", target: "p" }],
    }) as unknown as Deployment["graphSnapshot"],
    pipelineSnapshot: [
      { nodeId: "t", templateKind: "DEPOSIT_TRIGGER", contractAddress: T },
      { nodeId: "p", templateKind: "PAYER_DEV", contractAddress: P },
    ],
  };
}
function graph(d: ReturnType<typeof deployment>) {
  return FlowGraphSchema.parse(d.graphSnapshot);
}
function targets(address: string) {
  return [{ address, data: "" }];
}
beforeEach(() => {
  values.clear();
  balances.clear();
  read.mockReset();
  read.mockImplementation(async (addr: string, method: string) => {
    if (!values.has(`${addr}:${method}`)) throw new Error(`Missing fixture ${method}`);
    return values.get(`${addr}:${method}`);
  });
  values.set(`${T}:asset`, assetContractId(asset));
  values.set(`${T}:next_steps`, targets(P));
  values.set(`${P}:asset`, assetContractId(asset));
  values.set(`${P}:recipient`, null);
  values.set(`${P}:configured_amount`, 0n);
  values.set(`${P}:percentage_bps`, 0);
  values.set(`${P}:is_cash_out`, false);
});
describe("payout eligibility", () => {
  it("selects the snapshot Pay and configures API-filled values to 100%", async () => {
    const got = await payoutEligibility(deployment(), input);
    expect(got.required).toEqual({ amountStroops: "0", percentageBps: 10000 });
    expect(got.selected.contractAddress).toBe(P);
    expect(got.incoming).toBe("101");
  });
  it("preserves current fixed values and refuses leftovers", async () => {
    const d = deployment();
    const g = graph(d);
    const pay = g.nodes[1];
    if (pay?.type !== "pay") throw new Error();
    pay.config.fillValueViaApi = false;
    d.graphSnapshot = g as unknown as Deployment["graphSnapshot"];
    values.set(`${P}:configured_amount`, 102n);
    expect((await payoutEligibility(d, input)).required.amountStroops).toBe("102");
    values.set(`${P}:configured_amount`, 100n);
    await expect(payoutEligibility(d, input)).rejects.toThrow(/leave funds/);
  });
  it.each(["PENDING_SIGNATURE", "FAILED"] as const)(
    "requires confirmed deployments (%s)",
    async (status) => {
      const d = deployment();
      d.status = status;
      await expect(payoutEligibility(d, input)).rejects.toThrow(/not confirmed/);
    },
  );
  it("refuses selected Pay pooling, fiat configuration and mismatched assets", async () => {
    balances.set(P, 1n);
    await expect(payoutEligibility(deployment(), input)).rejects.toThrow(/pooled/);
    balances.clear();
    values.set(`${P}:is_cash_out`, true);
    await expect(payoutEligibility(deployment(), input)).rejects.toThrow(/Fiat/);
    values.set(`${P}:is_cash_out`, false);
    values.set(`${P}:asset`, Q);
    await expect(payoutEligibility(deployment(), input)).rejects.toThrow(/asset/);
  });
  it("requires explicit selection when there are multiple dev Pays", async () => {
    const d = deployment();
    const nodes = d.pipelineSnapshot as Array<{
      nodeId: string;
      templateKind: string;
      contractAddress: string;
    }>;
    nodes.push({ nodeId: "q", templateKind: "PAYER_DEV", contractAddress: Q });
    await expect(payoutEligibility(d, { ...input, nodeId: undefined })).rejects.toThrow(/Multiple/);
  });
  it("refuses changed or fan-out connectivity", async () => {
    values.set(`${T}:next_steps`, targets(Q));
    await expect(payoutEligibility(deployment(), input)).rejects.toThrow(/connectivity/);
    values.set(`${T}:next_steps`, [...targets(P), ...targets(Q)]);
    await expect(payoutEligibility(deployment(), input)).rejects.toThrow(/one immediate/);
  });
  it.each(["time_after", "multisig", "swap"])("refuses a %s path", async (kind) => {
    const d = deployment();
    const g = graph(d);
    if (kind === "swap")
      g.nodes.push({
        id: "c",
        type: "swap",
        config: {
          assetIn: asset,
          assetOut: { kind: "known", symbol: "USDC" },
          slippageBps: 100,
          deadlineSecs: 300,
        },
      });
    else
      g.nodes.push({
        id: "c",
        type: "condition",
        config:
          kind === "time_after"
            ? { kind, at: "2030-01-01T00:00:00Z" }
            : { kind: "multisig", threshold: 1, signers: [FROM] },
      });
    g.edges = [
      { id: "tc", source: "t", target: "c" },
      { id: "cp", source: "c", target: "p" },
    ];
    d.graphSnapshot = g as unknown as Deployment["graphSnapshot"];
    (d.pipelineSnapshot as object[]).push({
      nodeId: "c",
      contractAddress: C,
      templateKind: kind === "swap" ? "SWAPPER" : kind === "multisig" ? "MULTISIG" : "TIMELOCK",
    });
    values.set(`${T}:next_steps`, targets(C));
    await expect(payoutEligibility(d, input)).rejects.toThrow(/unsupported/);
  });
  function splitDeployment() {
    const d = deployment();
    const g = graph(d);
    g.nodes.push({
      id: "s",
      type: "split",
      config: { asset, recipients: [{ mode: "fixed", amountStroops: "100", address: FROM }] },
    });
    g.edges = [
      { id: "ts", source: "t", target: "s" },
      { id: "sp", source: "s", target: "p" },
    ];
    d.graphSnapshot = g as unknown as Deployment["graphSnapshot"];
    (d.pipelineSnapshot as object[]).push({
      nodeId: "s",
      templateKind: "SPLITTER_DEV",
      contractAddress: S,
    });
    values.set(`${T}:next_steps`, targets(S));
    values.set(`${S}:next_steps`, targets(P));
    values.set(`${S}:recipients`, [{ address: FROM, amount: 100n, bps: 0, is_cash_out: false }]);
    values.set(`${S}:total_fixed_amount`, 100n);
    values.set(`${S}:accumulated_balance`, 0n);
    return d;
  }
  it("accepts only fixed surplus forwarded immediately with empty balances", async () => {
    const d = splitDeployment();
    expect((await payoutEligibility(d, input)).incoming).toBe("1");
    for (const amount of ["99", "100"])
      await expect(payoutEligibility(d, { ...input, amount })).rejects.toThrow(/does not reach/);
    values.set(`${S}:accumulated_balance`, 1n);
    await expect(payoutEligibility(d, input)).rejects.toThrow(/pooled/);
    values.set(`${S}:accumulated_balance`, 0n);
    balances.set(S, 1n);
    await expect(payoutEligibility(d, input)).rejects.toThrow(/pooled/);
  });
  it.each(["SPLITTER", "SPLITTER_DEV"])(
    "supports both deployed Split variants (%s)",
    async (templateKind) => {
      const d = splitDeployment();
      const nodes = d.pipelineSnapshot as Array<{ nodeId: string; templateKind: string }>;
      nodes.find((n) => n.nodeId === "s")!.templateKind = templateKind;
      expect((await payoutEligibility(d, input)).incoming).toBe("1");
    },
  );
  it("refuses percentage and contract-recipient Split configurations", async () => {
    const d = splitDeployment();
    values.set(`${S}:total_fixed_amount`, 0n);
    values.set(`${S}:recipients`, [{ address: FROM, amount: 0n, bps: 10000, is_cash_out: false }]);
    await expect(payoutEligibility(d, input)).rejects.toThrow(/fixed crypto/);
    values.set(`${S}:total_fixed_amount`, 100n);
    values.set(`${S}:recipients`, [{ address: Q, amount: 100n, bps: 0, is_cash_out: true }]);
    await expect(payoutEligibility(d, input)).rejects.toThrow(/fixed crypto/);
  });
  it.each(["amount_gt", "amount_lt"] as const)(
    "uses on-chain router thresholds at the boundary (%s)",
    async (kind) => {
      const d = deployment();
      const g = graph(d);
      g.nodes.push({ id: "c", type: "condition", config: { kind, amountStroops: "100" } });
      g.nodes.push({ id: "q", type: "pay", config: { asset, recipient: FROM, fullAmount: true } });
      g.edges = [
        { id: "tc", source: "t", target: "c" },
        { id: "cp", source: "c", target: "p", sourceHandle: "true" },
        { id: "cq", source: "c", target: "q", sourceHandle: "false" },
      ];
      d.graphSnapshot = g as unknown as Deployment["graphSnapshot"];
      (d.pipelineSnapshot as object[]).push(
        { nodeId: "c", templateKind: "ROUTER", contractAddress: C },
        { nodeId: "q", templateKind: "PAYER_DEV", contractAddress: Q },
      );
      values.set(`${T}:next_steps`, targets(C));
      values.set(`${C}:threshold`, kind === "amount_gt" ? 101n : 100n);
      values.set(`${C}:path_a`, targets(kind === "amount_gt" ? P : Q));
      values.set(`${C}:path_b`, targets(kind === "amount_gt" ? Q : P));
      const succeeds = kind === "amount_gt" ? "101" : "99";
      expect((await payoutEligibility(d, { ...input, amount: succeeds })).incoming).toBe(succeeds);
      await expect(payoutEligibility(d, { ...input, amount: "100" })).rejects.toThrow(
        /unsupported/,
      );
    },
  );
});
