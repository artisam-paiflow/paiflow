/**
 * #722: lib/stellar/deploy.ts is the chokepoint every deploy passes through,
 * whichever route calls it, so it refuses a switched-off surface before any
 * RPC call or relayer signature.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: { getAccount: vi.fn() } }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => rpc,
  horizon: () => ({}),
  withRelayerLock: (fn: () => unknown) => fn(),
}));

const GRAPH = { nodes: [], edges: [] };
const NODES = [
  { nodeId: "t", templateKind: "DEPOSIT_TRIGGER", wasmHash: "a".repeat(64), params: {} },
  { nodeId: "c", templateKind: "CASH_OUT", wasmHash: "b".repeat(64), params: {} },
] as never;

afterEach(() => {
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import("@/lib/stellar/deploy");
}

describe("deploy chokepoint", () => {
  it("preparePipelineDeployTx refuses a retired CASH_OUT node before RPC", async () => {
    const { preparePipelineDeployTx } = await load();
    await expect(
      preparePipelineDeployTx({
        sourceAccount: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        graph: GRAPH as never,
        nodes: NODES,
      }),
    ).rejects.toThrow(/retired|off-ramp|CASH_OUT/i);
    expect(rpc.getAccount).not.toHaveBeenCalled();
  });

  it("deployPipelineByRelayer refuses it too, before touching the relayer key", async () => {
    const { deployPipelineByRelayer } = await load();
    await expect(deployPipelineByRelayer({ graph: GRAPH as never, nodes: NODES })).rejects.toThrow(
      /retired|off-ramp|CASH_OUT/i,
    );
  });

  it("refuses retired nodes even without a feature flag", async () => {
    const { deployPipelineByRelayer } = await load();
    await expect(deployPipelineByRelayer({ graph: GRAPH as never, nodes: NODES })).rejects.toThrow(
      /retired|off-ramp|CASH_OUT/i,
    );
  });
});
