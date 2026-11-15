import "server-only";
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  Address,
  BASE_FEE,
  Contract,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { AppError } from "@/lib/errors";
import { env, stellarPassphrase } from "@/lib/env";
import {
  ConditionalCanvasSchema,
  type ConditionalCanvas,
} from "@/lib/flows/conditional-canvas-schema";
import {
  conditionalCanvasIssues,
  conditionalDefinitionFromCanvas,
} from "@/lib/flows/conditional-canvas";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import { compileConditionalPipeline } from "@/lib/flows/conditional-v2-compiler";
import { ConditionalDeploymentReviewSchema } from "@/lib/deployments/conditional-review-schema";
import { ConditionalPipelineSnapshotSchema } from "./conditional-execution-state";
import { conditionalArtifactMetadata } from "./conditional-artifacts";
import { conditionalConstructorArgs, conditionalContractAddress } from "./conditional-v2-codec";
import type { PayoutRecipient } from "@/lib/flows/payout-recipients";
import { assetContractId } from "./assets";
import { getFactoryAddress, getWasmHashes } from "./config";
import { nodeBlueprint } from "./scval";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { deploymentPreparationRead } from "./deployment-preparation";
import { simulationFailure } from "./sim-error";

type Original = {
  id: string;
  network: string;
  sourceAccount: string | null;
  unsignedXdr: string | null;
  graphSnapshot?: unknown;
  paramsSnapshot?: unknown;
  pipelineSnapshot?: unknown;
  preparedTxHash?: string | null;
};
function invalid(): never {
  throw new AppError(
    "CONFLICT",
    "Conditional deployment original evidence is incomplete or inconsistent",
  );
}
function definition(draft: ConditionalCanvas, owner: string) {
  const receive = draft.nodes.find((node) => node.type === "on_receive");
  if (!receive || receive.type !== "on_receive")
    throw new AppError("VALIDATION", "Conditional flow requires Receive");
  return conditionalDefinitionFromCanvas(draft, {
    owner,
    assetContract: assetContractId(receive.config.asset),
  });
}
function blueprintArgs(
  envelope: ReturnType<typeof ConditionalDeploymentEnvelopeSchema.parse>,
  pipeline: ReturnType<typeof ConditionalPipelineSnapshotSchema.parse>,
) {
  return [
    new Address(envelope.definition.owner).toScVal(),
    xdr.ScVal.scvVec(
      envelope.nodes.map((node, index) =>
        nodeBlueprint(
          pipeline[index]!.wasmHash,
          Buffer.from(pipeline[index]!.salt, "hex"),
          conditionalConstructorArgs(node, envelope.manifest),
        ),
      ),
    ),
  ];
}
/** Validate original JSON and the exact factory body, never regenerate salts. */
export function verifyConditionalDeploymentOriginal(d: Original, expectedFactory?: string) {
  if (d.network !== env().STELLAR_NETWORK || !d.sourceAccount || !d.unsignedXdr) invalid();
  const draft = ConditionalCanvasSchema.parse(d.graphSnapshot);
  const envelope = ConditionalDeploymentEnvelopeSchema.parse(d.paramsSnapshot);
  const pipeline = ConditionalPipelineSnapshotSchema.parse(d.pipelineSnapshot);
  if (
    d.sourceAccount !== envelope.definition.owner ||
    !isDeepStrictEqual(definition(draft, d.sourceAccount), envelope.definition) ||
    pipeline.length !== envelope.nodes.length
  )
    invalid();
  for (const [index, node] of pipeline.entries()) {
    const compiled = envelope.nodes[index]!;
    if (
      node.nodeId !== compiled.nodeId ||
      node.templateKind !== compiled.templateKind ||
      node.contractAddress !== compiled.initialState.contractAddress ||
      node.wasmHash !== envelope.manifest.nodes[index]!.wasmHash ||
      !isDeepStrictEqual(node.implementation, compiled.implementation) ||
      !isDeepStrictEqual(
        node.artifactCapabilities,
        conditionalArtifactMetadata(node.templateKind, node.wasmHash),
      ) ||
      conditionalContractAddress(
        d.sourceAccount,
        Buffer.from(node.salt, "hex"),
        stellarPassphrase(),
      ) !== node.contractAddress
    )
      invalid();
  }
  const tx = TransactionBuilder.fromXDR(d.unsignedXdr, stellarPassphrase());
  if (
    !(tx instanceof Transaction) ||
    tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
    tx.source !== d.sourceAccount ||
    tx.signatures.length ||
    tx.memo.type !== "none" ||
    tx.operations.length !== 1 ||
    BigInt(tx.fee) <= 0n ||
    !tx.timeBounds ||
    tx.timeBounds.minTime !== "0" ||
    BigInt(tx.timeBounds.maxTime) <= 0n ||
    !tx.toEnvelope().v1().tx().ext().sorobanData()
  )
    invalid();
  const operation = tx.operations[0]!;
  if (
    operation.type !== "invokeHostFunction" ||
    operation.source ||
    operation.func.switch().name !== "hostFunctionTypeInvokeContract"
  )
    invalid();
  const invoke = operation.func.invokeContract();
  if (
    invoke.functionName().toString() !== "deploy_pipeline" ||
    (expectedFactory &&
      Address.fromScAddress(invoke.contractAddress()).toString() !== expectedFactory)
  )
    invalid();
  const args = blueprintArgs(envelope, pipeline);
  if (
    invoke.args().length !== args.length ||
    invoke.args().some((arg, index) => !arg.toXDR().equals(args[index]!.toXDR()))
  )
    invalid();
  for (const auth of operation.auth ?? [])
    if (auth.credentials().switch().name !== "sorobanCredentialsSourceAccount") invalid();
  const txHash = tx.hash().toString("hex");
  if (!d.preparedTxHash || d.preparedTxHash !== txHash) invalid();
  return {
    tx,
    envelope,
    pipeline,
    conditionalReview: ConditionalDeploymentReviewSchema.parse({
      version: 2,
      deploymentId: d.id,
      network: d.network,
      networkPassphrase: stellarPassphrase(),
      sourceAccount: d.sourceAccount,
      txHash,
      envelope,
    }),
  };
}
/** Check all required authoritative pins before account/RPC or deployment writes. */
export async function conditionalDeploymentPlan(raw: ConditionalCanvas, sourceAccount: string) {
  const draft = ConditionalCanvasSchema.parse(raw);
  const issues = conditionalCanvasIssues(draft);
  if (issues.length)
    throw new AppError("VALIDATION", "Conditional flow is invalid", {
      graph: issues.map((issue) => issue.message),
    });
  const normalized = definition(draft, sourceAccount);
  const hashes = await getWasmHashes(env().STELLAR_NETWORK);
  const factoryAddress = await getFactoryAddress();
  if (!factoryAddress) throw new AppError("VALIDATION", "Pipeline factory is unavailable");
  const identities = [
    { nodeId: normalized.root.nodeId, kind: "DEPOSIT_TRIGGER" },
    ...normalized.prefix.map((n) => ({ nodeId: n.nodeId, kind: "PAYER" })),
    { nodeId: normalized.condition.nodeId, kind: "ROUTER" },
    ...[normalized.trueBranch, normalized.falseBranch].map((n) => ({
      nodeId: n.nodeId,
      kind: n.kind === "split" ? "SPLITTER" : "PAYER",
    })),
  ];
  const salts = identities.map(() => randomBytes(32));
  const bindings = identities.map((node, index) => {
    const wasmHash = hashes.get(node.kind as Parameters<typeof hashes.get>[0]);
    if (!wasmHash)
      throw new AppError("VALIDATION", `Conditional ${node.kind} artifact is unavailable`);
    try {
      conditionalArtifactMetadata(node.kind, wasmHash);
    } catch {
      throw new AppError("VALIDATION", `Conditional ${node.kind} artifact is unavailable`);
    }
    return {
      nodeId: node.nodeId,
      wasmHash,
      expectedRevision: "0",
      contractAddress: conditionalContractAddress(
        sourceAccount,
        salts[index]!,
        stellarPassphrase(),
      ),
    };
  });
  const compiled = compileConditionalPipeline(normalized, bindings);
  const envelope = ConditionalDeploymentEnvelopeSchema.parse({
    version: 2,
    generation: "conditional-v2",
    definition: compiled.definition,
    manifest: compiled.manifest,
    nodes: compiled.nodes,
  });
  const pipeline = ConditionalPipelineSnapshotSchema.parse(
    compiled.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      templateKind: node.templateKind,
      contractAddress: bindings[index]!.contractAddress,
      salt: salts[index]!.toString("hex"),
      implementation: node.implementation,
      wasmHash: bindings[index]!.wasmHash,
      artifactCapabilities: conditionalArtifactMetadata(
        node.templateKind,
        bindings[index]!.wasmHash,
      ),
    })),
  );
  const receive = draft.nodes.find((node) => node.type === "on_receive")!;
  if (receive.type !== "on_receive") invalid();
  const recipients: PayoutRecipient[] = [];
  for (const node of envelope.nodes) {
    const c = node.initialState.configuration;
    const add = (address: string) =>
      recipients.push({ nodeId: node.nodeId, address, asset: receive.config.asset });
    if (c.kind === "return_to_owner") add(c.recipient);
    else if (c.kind === "pay" && c.configuration.recipient) add(c.configuration.recipient);
    else if (c.kind === "split") {
      for (const row of c.configuration.configuredRows) if (row.recipient) add(row.recipient);
      for (const row of c.configuration.additionalRecipients ?? []) add(row.recipient);
    }
  }
  return { draft, envelope, pipeline, factoryAddress, recipients };
}
export async function prepareConditionalDeployTransaction(
  plan: Awaited<ReturnType<typeof conditionalDeploymentPlan>>,
  deploymentId: string,
) {
  const server = sorobanRpc();
  const source = plan.envelope.definition.owner;
  const account = await deploymentPreparationRead(
    "account",
    () => loadPaymentAccount(server, source),
    deploymentId,
  );
  if (account.accountId() !== source)
    throw new AppError("VALIDATION", "Deployment source must match its immutable owner");
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(
      new Contract(plan.factoryAddress).call(
        "deploy_pipeline",
        ...blueprintArgs(plan.envelope, plan.pipeline),
      ),
    )
    .setTimeout(180)
    .build();
  const simulation = await deploymentPreparationRead(
    "simulation",
    () => server.simulateTransaction(tx),
    deploymentId,
  );
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  if (!rpc.Api.isSimulationSuccess(simulation))
    throw new AppError("UPSTREAM_RPC", "Deployment simulation unavailable");
  const xdr = rpc.assembleTransaction(tx, simulation).build().toXDR();
  const verified = verifyConditionalDeploymentOriginal(
    {
      id: deploymentId,
      network: env().STELLAR_NETWORK,
      sourceAccount: source,
      unsignedXdr: xdr,
      preparedTxHash: TransactionBuilder.fromXDR(xdr, stellarPassphrase()).hash().toString("hex"),
      graphSnapshot: plan.draft,
      paramsSnapshot: plan.envelope,
      pipelineSnapshot: plan.pipeline,
    },
    plan.factoryAddress,
  );
  return { xdr, pipeline: plan.pipeline, conditionalReview: verified.conditionalReview };
}
