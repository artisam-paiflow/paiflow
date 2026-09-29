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
  delete process.env.FEATURE_OFFRAMP_ENABLED;
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import("@/lib/stellar/deploy");
}

describe("deploy chokepoint", () => {
  it("preparePipelineDeployTx refuses a CASH_OUT node with the off-ramp off", async () => {
    process.env.FEATURE_OFFRAMP_ENABLED = "false";
    const { preparePipelineDeployTx } = await load();
    await expect(
      preparePipelineDeployTx({
        sourceAccount: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        graph: GRAPH as never,
        nodes: NODES,
      }),
    ).rejects.toThrow(/CASH_OUT contract, which is turned off/);
    expect(rpc.getAccount).not.toHaveBeenCalled();
  });

  it("deployPipelineByRelayer refuses it too, before touching the relayer key", async () => {
    process.env.FEATURE_OFFRAMP_ENABLED = "false";
    const { deployPipelineByRelayer } = await load();
    await expect(deployPipelineByRelayer({ graph: GRAPH as never, nodes: NODES })).rejects.toThrow(
      /turned off/,
    );
  });

  it("lets the same nodes through to the relayer-config check when the switch is on", async () => {
    const { deployPipelineByRelayer } = await load();
    await expect(deployPipelineByRelayer({ graph: GRAPH as never, nodes: NODES })).rejects.toThrow(
      /STELLAR_RELAYER_ADDRESS/,
    );
  });
});
