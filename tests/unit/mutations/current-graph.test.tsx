import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import type { Deployment } from "@prisma/client";
import { useConfirmedConfigurationGraph } from "@/lib/hooks/use-confirmed-configuration-graph";
import { FlowGraphSchema } from "@/lib/flows/schema";
import {
  MUTATION_V1_WASM_HASHES,
  executionArtifactMetadata,
} from "@/lib/stellar/execution-artifacts";
const wallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  nextRecipient = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const root = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  child = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const policies = {
  version: 1 as const,
  nodes: [
    {
      kind: "pay" as const,
      nodeId: "pay",
      recipient: "mutable" as const,
      payoutValue: "mutable" as const,
    },
  ],
};
const graph = FlowGraphSchema.parse({
  nodes: [
    { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "pay",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: wallet,
        fullAmount: false,
        amountStroops: "100",
        mode: "fixed",
      },
    },
  ],
  edges: [{ id: "e", source: "root", target: "pay" }],
  fieldPolicies: policies,
});
function current(deployment: Pick<Deployment, "id">) {
  return {
    supported: true,
    policyVersion: 1,
    deploymentId: deployment.id,
    network: "testnet",
    confirmedLedger: 100,
    rootContract: root,
    assetContract: child,
    minAmountStroops: "0",
    policies,
    nodes: [
      {
        nodeId: "root",
        contractAddress: root,
        expectedRevision: "0",
        capabilities: executionArtifactMetadata(
          "DEPOSIT_TRIGGER",
          MUTATION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
        ),
      },
      {
        nodeId: "pay",
        contractAddress: child,
        expectedRevision: "0",
        capabilities: executionArtifactMetadata("PAYER", MUTATION_V1_WASM_HASHES.PAYER),
      },
    ],
    configurations: [
      {
        version: 1,
        nodeId: "pay",
        contractAddress: child,
        confirmedLedger: 100,
        revision: "0",
        policy: policies.nodes[0],
        configuration: {
          kind: "pay",
          recipient: wallet,
          payoutValue: { kind: "fixed", amountStroops: "100" },
        },
      },
    ],
    admin: wallet,
    mutationSupported: true,
    obligations: [{ nodeId: "pay", obligationsStroops: "0" }],
  };
}
const id = "11111111-1111-4111-8111-111111111111";
const fetcher = vi.fn();
function Current({ tick = 0, deploymentId = id }: { tick?: number; deploymentId?: string }) {
  const state = useConfirmedConfigurationGraph(deploymentId, graph, tick);
  const recipient = state.graph?.nodes.find((n) => n.type === "pay")?.config.recipient;
  return (
    <div>
      <span>{recipient ?? "Current terms unavailable"}</span>
      <output>{state.configurationLedger ?? "unverified"}</output>
    </div>
  );
}
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("confirmed deployed graph observations", () => {
  it("hides initial terms until verified current read, then reflects direct-chain changes and hides on failure", async () => {
    let resolve: (value: Response) => void = () => {};
    fetcher.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const view = render(<Current />);
    expect(screen.getByText("Current terms unavailable")).toBeDefined();
    const state = current({ id } as Deployment);
    state.configurations[0]!.revision = "1";
    state.nodes[1]!.expectedRevision = "1";
    if (state.configurations[0]!.configuration.kind === "pay")
      state.configurations[0]!.configuration.recipient = nextRecipient;
    resolve(Response.json({ data: state }));
    await waitFor(() => expect(screen.getByText(nextRecipient)).toBeDefined());
    fetcher.mockRejectedValue(new Error("offline"));
    view.rerender(<Current tick={1} />);
    await waitFor(() => expect(screen.getByText("Current terms unavailable")).toBeDefined());
    expect(screen.queryByText(nextRecipient)).toBeNull();
  });
  it("refuses foreign-deployment responses before displaying terms", async () => {
    fetcher.mockResolvedValue(
      Response.json({
        data: current({ id: "22222222-2222-4222-8222-222222222222" } as Deployment),
      }),
    );
    render(<Current />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(screen.getByText("Current terms unavailable")).toBeDefined();
  });
});
