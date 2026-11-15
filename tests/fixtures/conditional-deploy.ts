import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import { conditionalPayer } from "./conditional-v2-acceptance";

export function conditionalDeployCanvas() {
  const owner = conditionalDeploySigner().publicKey(),
    payer = conditionalPayer;
  return {
    owner,
    payer,
    graph: ConditionalCanvasSchema.parse({
      generation: "conditional-v2",
      conditionalPolicies: {
        version: 2,
        nodes: [],
        condition: { nodeId: "condition", thresholdMode: "mutable" },
      },
      nodes: [
        { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
        {
          id: "prefix",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: payer,
            mode: "percentage",
            percentage: 10,
          },
        },
        { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "500" } },
        {
          id: "yes",
          type: "pay",
          config: { asset: { kind: "native" }, recipient: payer, fullAmount: true },
        },
        { id: "no", type: "return_to_owner", config: {} },
      ],
      edges: [
        { id: "a", source: "receive", target: "prefix" },
        { id: "b", source: "prefix", target: "condition" },
        { id: "t", source: "condition", target: "yes", sourceHandle: "true" },
        { id: "f", source: "condition", target: "no", sourceHandle: "false" },
      ],
    }),
  };
}

import {
  Account,
  Address,
  Asset,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { conditionalDefinitionFromCanvas } from "@/lib/flows/conditional-canvas";
import { compileConditionalPipeline } from "@/lib/flows/conditional-v2-compiler";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import {
  CONDITIONAL_V2_WASM_HASHES,
  conditionalArtifactMetadata,
} from "@/lib/stellar/conditional-artifacts";
import {
  conditionalContractAddress,
  conditionalConstructorArgs,
} from "@/lib/stellar/conditional-v2-codec";
import { ConditionalDeploymentReviewSchema } from "@/lib/deployments/conditional-review-schema";

export const conditionalDeploySigner = () => Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42));

/** Synthetic unsigned factory original; never a submission or network proof. */
export function conditionalPreparedFixture() {
  const { graph, owner } = conditionalDeployCanvas();
  const definition = conditionalDefinitionFromCanvas(graph, {
    owner,
    assetContract: Asset.native().contractId(Networks.TESTNET),
  });
  const kinds = ["DEPOSIT_TRIGGER", "PAYER", "ROUTER", "PAYER", "PAYER"] as const;
  const ids = ["receive", "prefix", "condition", "yes", "no"];
  const bindings = ids.map((nodeId, index) => ({
    nodeId,
    expectedRevision: "0",
    contractAddress: conditionalContractAddress(
      owner,
      Buffer.alloc(32, index + 1),
      Networks.TESTNET,
    ),
    wasmHash: CONDITIONAL_V2_WASM_HASHES[kinds[index]!],
  }));
  const compiled = compileConditionalPipeline(definition, bindings);
  const envelope = ConditionalDeploymentEnvelopeSchema.parse({
    version: 2,
    generation: "conditional-v2",
    definition,
    manifest: compiled.manifest,
    nodes: compiled.nodes,
  });
  const pipeline = compiled.nodes.map((node, index) => ({
    nodeId: node.nodeId,
    contractAddress: bindings[index]!.contractAddress,
    templateKind: node.templateKind,
    implementation: node.implementation,
    salt: Buffer.alloc(32, index + 1).toString("hex"),
    wasmHash: bindings[index]!.wasmHash,
    artifactCapabilities: conditionalArtifactMetadata(node.templateKind, bindings[index]!.wasmHash),
  }));
  const blueprints = compiled.nodes.map((node, index) =>
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("constructor_args"),
        val: xdr.ScVal.scvVec(conditionalConstructorArgs(node, compiled.manifest)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("salt"),
        val: xdr.ScVal.scvBytes(Buffer.from(pipeline[index]!.salt, "hex")),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("wasm_hash"),
        val: xdr.ScVal.scvBytes(Buffer.from(bindings[index]!.wasmHash, "hex")),
      }),
    ]),
  );
  const factory = Address.contract(Buffer.alloc(32, 66)).toString();
  const tx = new TransactionBuilder(new Account(owner, "10"), {
    fee: "1100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(factory).call(
        "deploy_pipeline",
        new Address(owner).toScVal(),
        xdr.ScVal.scvVec(blueprints),
      ),
    )
    .setTimeout(180)
    .setSorobanData(new SorobanDataBuilder().setResourceFee("1000").build())
    .build();
  const deploymentId = "12271227-1227-4227-8227-122712271227";
  const txHash = tx.hash().toString("hex");
  const conditionalReview = ConditionalDeploymentReviewSchema.parse({
    version: 2,
    deploymentId,
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    sourceAccount: owner,
    txHash,
    envelope,
  });
  return {
    graph,
    owner,
    envelope,
    pipeline,
    factory,
    tx,
    txHash,
    deploymentId,
    xdr: tx.toXDR(),
    networkPassphrase: Networks.TESTNET,
    conditionalReview,
  };
}
