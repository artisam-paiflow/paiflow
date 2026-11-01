import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
const mock = vi.hoisted(() => ({
  current: vi.fn(),
  observe: vi.fn(),
  simulate: vi.fn(),
  latest: vi.fn(),
  account: vi.fn(),
}));
vi.mock("@/lib/stellar/execution-state", () => ({ readExecutionState: mock.current }));
vi.mock("@/lib/mutations/history", () => ({ recordConfigurationObservation: mock.observe }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ simulateTransaction: mock.simulate, getLatestLedger: mock.latest }),
}));
vi.mock("@/lib/stellar/load-payment-account", () => ({ loadPaymentAccount: mock.account }));
import { readMutationState } from "@/lib/stellar/mutation-state";
import { admin, current, root, asset } from "./fixtures";
const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceAccount: admin.publicKey(),
} as Deployment;
function abi(value: unknown): xdr.ScVal {
  if (typeof value === "number") return nativeToScVal(value, { type: "u32" });
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(abi));
  if (value && typeof value === "object")
    return xdr.ScVal.scvMap(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(
          ([key, val]) =>
            new xdr.ScMapEntry({ key: nativeToScVal(key, { type: "symbol" }), val: abi(val) }),
        ),
    );
  return nativeToScVal(value);
}
let status: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  mock.current.mockResolvedValue(current(deployment));
  mock.account.mockResolvedValue(new Account(admin.publicKey(), "10"));
  mock.latest.mockResolvedValue({ sequence: 100 });
  mock.observe.mockResolvedValue(undefined);
  status = {
    node_id: "pay",
    admin: admin.publicKey(),
    asset,
    parent: root,
    next_steps: [],
    revision: 0n,
    obligations: 0n,
  };
  mock.simulate.mockImplementation(async () => ({
    id: "x",
    latestLedger: 100,
    result: { retval: abi(status) },
    events: [],
    transactionData: { build: () => undefined },
    minResourceFee: "100",
  }));
});
describe("verified mutation state", () => {
  it("uses stable confirmed getters and persists observations separately", async () => {
    const state = await readMutationState(deployment);
    expect(state.admin).toBe(admin.publicKey());
    expect(state.obligations[0]!.obligationsStroops).toBe("0");
    expect(mock.observe).toHaveBeenCalledTimes(1);
  });
  it.each([
    { parent: asset },
    { admin: root },
    { asset: root },
    { revision: 1n },
    { node_id: "foreign" },
    { obligations: -1n },
    { next_steps: [{ address: root, data: "" }] },
  ])("refuses mismatched authority/path/revision/accounting", async (change) => {
    Object.assign(status, change);
    await expect(readMutationState(deployment)).rejects.toBeDefined();
    expect(mock.observe).not.toHaveBeenCalled();
  });
  it("reports accounted obligations even when raw token balance is absent", async () => {
    status.obligations = 200n;
    expect((await readMutationState(deployment)).obligations[0]!.obligationsStroops).toBe("200");
  });
  it("refuses unsupported artifacts, RPC failures and changing ledgers without saving stale config", async () => {
    mock.current.mockResolvedValue({
      ...current(deployment),
      nodes: current(deployment).nodes.map((n) => ({
        ...n,
        capabilities: { ...n.capabilities, mutation: false },
      })),
    });
    await expect(readMutationState(deployment)).rejects.toMatchObject({ code: "VALIDATION" });
    mock.current.mockResolvedValue(current(deployment));
    mock.latest.mockResolvedValue({ sequence: 101 });
    await expect(readMutationState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
    expect(mock.observe).not.toHaveBeenCalled();
    mock.simulate.mockResolvedValue({ error: "offline", latestLedger: 100 });
    await expect(readMutationState(deployment)).rejects.toMatchObject({ code: "UPSTREAM_RPC" });
  });
});
