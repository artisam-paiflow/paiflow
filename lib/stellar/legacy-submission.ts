import "server-only";
import { createHash } from "node:crypto";
import type { Deployment, Prisma, SignedTransaction, SignedTxKind } from "@prisma/client";
import {
  Address,
  StrKey,
  Transaction,
  TransactionBuilder,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { hasExecutionPolicies } from "@/lib/api/v1/execution-schema";
import { db } from "@/lib/db";
import { lockDeployment } from "@/lib/deployments/service-work";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
import {
  captureTransactionSigned,
  insertSignedTransaction,
  signedTransactionRow,
} from "@/lib/signed-tx";
import { signerFromTransaction, type SignerInfo } from "./signer";

export type LegacySubmissionKind = Extract<SignedTxKind, "TRIGGER" | "INVOKE">;
export type LegacySubmissionDeployment = Pick<
  Deployment,
  | "id"
  | "network"
  | "status"
  | "contractAddress"
  | "pipelineSnapshot"
  | "graphSnapshot"
  | "paramsSnapshot"
  | "sourceAccount"
  | "chargeRelayerAddress"
  | "chargeRelayerMode"
> & { flow: { templateKind: string } };
type VerifiedSigner = Extract<SignerInfo, { ok: true }>;

type Invocation = {
  contractAddress: string;
  method: string;
  amountStroops: string | null;
  newRelayerAddress: string | null;
};

const deploymentSelect = {
  id: true,
  network: true,
  status: true,
  contractAddress: true,
  pipelineSnapshot: true,
  graphSnapshot: true,
  paramsSnapshot: true,
  sourceAccount: true,
  chargeRelayerAddress: true,
  chargeRelayerMode: true,
  flow: { select: { templateKind: true } },
} satisfies Prisma.DeploymentSelect;

function refuse(message: string): never {
  throw new AppError("VALIDATION", message);
}

function snapshotDigest(deployment: LegacySubmissionDeployment): string {
  const canonical = (value: Prisma.JsonValue): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry ?? null)}`)
        .join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  return createHash("sha256")
    .update(
      canonical({
        deploymentId: deployment.id,
        network: deployment.network,
        root: deployment.contractAddress,
        sourceAccount: deployment.sourceAccount,
        graph: deployment.graphSnapshot,
        params: deployment.paramsSnapshot,
        pipeline: deployment.pipelineSnapshot,
        templateKind: deployment.flow.templateKind,
      }),
    )
    .digest("hex");
}

function parseEnvelope(value: string, deployment: LegacySubmissionDeployment): Transaction {
  if (deployment.network !== env().STELLAR_NETWORK)
    throw new AppError("CONFLICT", "Deployment network does not match this environment");
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(value, stellarPassphrase());
  } catch {
    return refuse("Invalid transaction envelope");
  }
  if (!(tx instanceof Transaction)) return refuse("Fee-bump transactions are not supported here");
  if (!StrKey.isValidEd25519PublicKey(tx.source))
    return refuse("Transaction source must be an account address");
  if (
    !tx.timeBounds ||
    !/^[0-9]+$/.test(tx.timeBounds.maxTime) ||
    BigInt(tx.timeBounds.maxTime) === 0n
  )
    return refuse("Transaction must have finite time bounds");
  return tx;
}

function assertFresh(tx: Transaction): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    !tx.timeBounds ||
    BigInt(tx.timeBounds.maxTime) <= now ||
    BigInt(tx.timeBounds.minTime) > now ||
    BigInt(tx.timeBounds.maxTime) > now + 300n
  )
    return refuse("Prepared transaction is expired or outside its bounded signing window");
}

function invocation(
  tx: Transaction,
  deployment: LegacySubmissionDeployment,
  kind: LegacySubmissionKind,
): Invocation {
  if (deployment.status !== "CONFIRMED") return refuse("Deployment is not confirmed");
  const operation = tx.operations[0];
  if (
    tx.operations.length !== 1 ||
    !operation ||
    operation.type !== "invokeHostFunction" ||
    operation.source
  )
    return refuse("Expected exactly one contract invocation without an operation source override");
  if (operation.func.switch().name !== "hostFunctionTypeInvokeContract")
    return refuse("Only a prepared contract invocation is supported");
  if (
    operation.auth?.some(
      (entry) => entry.credentials().switch().name !== "sorobanCredentialsSourceAccount",
    )
  )
    return refuse("Only transaction-source contract authorization is supported");
  const call = operation.func.invokeContract();
  const target = Address.fromScAddress(call.contractAddress()).toString();
  const method = call.functionName().toString();
  const args = call.args();
  const rawPipeline = deployment.pipelineSnapshot;
  const pipeline =
    rawPipeline === null || (Array.isArray(rawPipeline) && rawPipeline.length === 0)
      ? []
      : BalancePipelineSnapshotSchema.parse(rawPipeline);
  const root = pipeline[0];
  if (
    !deployment.contractAddress ||
    !StrKey.isValidContract(deployment.contractAddress) ||
    (root && root.contractAddress !== deployment.contractAddress)
  )
    return refuse("Deployment root does not match its durable pipeline");
  let amountStroops: string | null = null;
  let newRelayerAddress: string | null = null;
  if (kind === "TRIGGER") {
    if (hasExecutionPolicies(deployment.graphSnapshot))
      return refuse("Policy-v1 payments require their exact execution flow");
    const rootKind = root?.templateKind ?? deployment.flow.templateKind;
    const expectedMethod =
      rootKind === "STREAMER"
        ? "top_up"
        : rootKind === "DEPOSIT_TRIGGER" || rootKind === "WEBHOOK"
          ? "deposit"
          : !root && rootKind === "SPLITTER"
            ? "distribute"
            : null;
    if (
      !expectedMethod ||
      target !== deployment.contractAddress ||
      method !== expectedMethod ||
      args.length !== 2
    )
      return refuse("Transaction does not match this deployment's funding operation");
    if (
      args[0]?.toXDR("base64") !== new Address(tx.source).toScVal().toXDR("base64") ||
      args[1]?.switch().name !== "scvI128"
    )
      return refuse("Funding arguments do not match the transaction source and amount");
    const amount: unknown = scValToNative(args[1]);
    if (typeof amount !== "bigint" || amount <= 0n)
      return refuse("Funding amount must be positive stroops");
    amountStroops = amount.toString();
  } else {
    const streamer = ["pause", "unpause", "retrieve_unvested"].includes(method);
    const subscription = ["charge", "subscribe", "unsubscribe", "set_relayer"].includes(method);
    if (!streamer && !subscription) return refuse("Unsupported deployment control operation");
    const targets = pipeline.filter(
      (node) => node.templateKind === (streamer ? "STREAMER" : "SUBSCRIPTION"),
    );
    if (targets.length !== 1 || targets[0]?.contractAddress !== target)
      return refuse("Control target does not match the durable deployment pipeline");
    const graph = FlowGraphSchema.safeParse(deployment.graphSnapshot);
    if (!graph.success) return refuse("Deployment graph snapshot cannot authorize this control");
    const trigger = graph.data.nodes.find(isTrigger);
    if (streamer) {
      if (
        trigger?.type !== "on_schedule" ||
        (method === "retrieve_unvested"
          ? trigger.config.retrieveAllowed !== true
          : trigger.config.pauseAllowed === false)
      )
        return refuse("This control is not allowed by the deployed schedule");
    } else if (trigger?.type !== "subscription")
      return refuse("Deployment has no subscription trigger");
    const subscriber = trigger?.type === "subscription" ? trigger.config.subscriber : null;
    const expectedSource =
      method === "subscribe" || method === "unsubscribe" ? subscriber : deployment.sourceAccount;
    if (!expectedSource || tx.source !== expectedSource)
      return refuse("Control source does not match the deployed authorizer");
    if (method === "set_relayer") {
      if (args.length !== 1 || args[0]?.switch().name !== "scvAddress")
        return refuse("Invalid relayer control arguments");
      newRelayerAddress = Address.fromScVal(args[0]).toString();
      if (!StrKey.isValidEd25519PublicKey(newRelayerAddress))
        return refuse("Relayer must be an account address");
    } else if (args.length !== 0) return refuse("Unexpected deployment control arguments");
  }
  return { contractAddress: target, method, amountStroops, newRelayerAddress };
}

function assertDesiredRelayer(deployment: LegacySubmissionDeployment, call: Invocation): void {
  if (
    call.method === "set_relayer" &&
    (deployment.chargeRelayerMode === "MANUAL" ||
      deployment.chargeRelayerAddress !== call.newRelayerAddress)
  )
    return refuse("Prepared relayer does not match the desired deployment configuration");
}

async function lockedDeployment(
  client: Prisma.TransactionClient,
  deployment: LegacySubmissionDeployment,
  fresh: boolean,
): Promise<LegacySubmissionDeployment> {
  const locked = await lockDeployment(client, deployment.id);
  if (fresh && locked.serviceState !== "ACTIVE")
    throw new AppError("CONFLICT", "Deployment is not accepting new wallet submissions");
  const current = await client.deployment.findUnique({
    where: { id: deployment.id },
    select: deploymentSelect,
  });
  if (!current) throw new AppError("NOT_FOUND", "Deployment not found");
  if (
    current.status !== "CONFIRMED" ||
    current.network !== env().STELLAR_NETWORK ||
    snapshotDigest(current) !== snapshotDigest(deployment)
  )
    throw new AppError(
      "CONFLICT",
      "Deployment evidence changed; retain the original transaction identity",
    );
  return current;
}

/** Persist the exact simulated transaction before returning its unsigned envelope.
 * The hash binds every transaction field, including asset/auth/resource/fee data;
 * signatures stay outside the approval evidence. No existing approval is changed. */
export async function registerLegacyPreparation(input: {
  deployment: LegacySubmissionDeployment;
  kind: LegacySubmissionKind;
  unsignedXdr: string;
  sourceAddress: string;
  contractAddress: string;
  method: string;
  amount?: string;
  expectedArgs?: readonly xdr.ScVal[];
}): Promise<void> {
  const tx = parseEnvelope(input.unsignedXdr, input.deployment);
  if (tx.signatures.length !== 0 || tx.source !== input.sourceAddress)
    return refuse("Prepared transaction source or signature mismatch");
  assertFresh(tx);
  const call = invocation(tx, input.deployment, input.kind);
  if (
    call.contractAddress !== input.contractAddress ||
    call.method !== input.method ||
    call.amountStroops !== (input.amount ?? null)
  )
    return refuse("Prepared transaction does not match the requested operation");
  if (call.method === "set_relayer") {
    if (
      input.expectedArgs?.length !== 1 ||
      input.expectedArgs[0]?.toXDR("base64") !==
        new Address(call.newRelayerAddress!).toScVal().toXDR("base64")
    )
      return refuse("Prepared relayer does not match the requested address");
  } else if (input.expectedArgs !== undefined)
    return refuse("Unexpected prepared control arguments");
  await db.$transaction(async (client) => {
    const current = await lockedDeployment(client, input.deployment, true);
    assertFresh(tx);
    assertDesiredRelayer(current, call);
    const row = {
      txHash: tx.hash().toString("hex"),
      deploymentId: current.id,
      network: current.network,
      kind: input.kind,
      sourceAddress: tx.source,
      contractAddress: call.contractAddress,
      method: call.method,
      amountStroops: call.amountStroops,
      maxTime: tx.timeBounds!.maxTime,
      snapshotDigest: snapshotDigest(current),
    };
    await client.walletSubmissionPreparation.createMany({ data: [row], skipDuplicates: true });
    const stored = await client.walletSubmissionPreparation.findUnique({
      where: { txHash: row.txHash },
    });
    if (
      !stored ||
      Object.entries(row).some(([key, value]) => stored[key as keyof typeof row] !== value)
    )
      throw new AppError("CONFLICT", "Transaction preparation already belongs to another scope");
  });
}

function assertJournalScope(
  existing: SignedTransaction,
  deployment: LegacySubmissionDeployment,
  kind: LegacySubmissionKind,
  signer: VerifiedSigner,
): void {
  if (
    existing.deploymentId !== deployment.id ||
    existing.network !== deployment.network ||
    existing.kind !== kind ||
    existing.signerAddress !== signer.signerAddress ||
    !existing.signedBySource ||
    existing.isFeeBump ||
    existing.muxedSource
  )
    throw new AppError(
      "CONFLICT",
      "Transaction journal does not match this deployment and operation",
    );
}

/** Verify consent and durably claim the first submission before any network send.
 * A replay is receipt recovery only, including historical correctly bound journals
 * that predate approval storage. Callers must never send when replay is true. */
export async function admitLegacySubmission(input: {
  deployment: LegacySubmissionDeployment;
  kind: LegacySubmissionKind;
  signedXdr: string;
  userId?: string | null;
  ip?: string | null;
}): Promise<{
  tx: Transaction;
  signer: VerifiedSigner;
  replay: boolean;
  receipt?: Pick<SignedTransaction, "outcome" | "ledger">;
}> {
  const tx = parseEnvelope(input.signedXdr, input.deployment);
  const signer = signerFromTransaction(tx);
  if (!signer.ok || !signer.signedBySource || signer.isFeeBump || signer.muxedSource)
    throw new AppError("FORBIDDEN", "A valid transaction-source wallet signature is required");
  const call = invocation(tx, input.deployment, input.kind);
  const row = signedTransactionRow({
    signer,
    kind: input.kind,
    network: input.deployment.network,
    deploymentId: input.deployment.id,
    userId: input.userId,
    ip: input.ip,
  });
  if (!row) throw new AppError("INTERNAL", "Verified transaction could not be recorded");
  const admission = await db.$transaction(async (client) => {
    // The deployment lock also serializes competing first submissions across replicas.
    const current = await lockedDeployment(client, input.deployment, false);
    const existing = await client.signedTransaction.findUnique({
      where: { txHash: signer.txHash },
    });
    if (existing) {
      assertJournalScope(existing, current, input.kind, signer);
      return { created: false, receipt: { outcome: existing.outcome, ledger: existing.ledger } };
    }
    // Only this branch may lead to a send. Historic receipts never bypass scope checks.
    const locked = await lockDeployment(client, current.id);
    if (locked.serviceState !== "ACTIVE")
      throw new AppError("CONFLICT", "Deployment is not accepting new wallet submissions");
    assertFresh(tx);
    assertDesiredRelayer(current, call);
    const preparation = await client.walletSubmissionPreparation.findUnique({
      where: { txHash: signer.txHash },
    });
    if (
      !preparation ||
      preparation.deploymentId !== current.id ||
      preparation.network !== current.network ||
      preparation.kind !== input.kind ||
      preparation.sourceAddress !== tx.source ||
      preparation.contractAddress !== call.contractAddress ||
      preparation.method !== call.method ||
      preparation.amountStroops !== call.amountStroops ||
      preparation.maxTime !== tx.timeBounds!.maxTime ||
      preparation.snapshotDigest !== snapshotDigest(current)
    )
      return refuse("Signed transaction does not match an exact server-approved preparation");
    const created = await insertSignedTransaction(row, client);
    if (created) return { created: true };
    const raced = await client.signedTransaction.findUnique({ where: { txHash: signer.txHash } });
    if (!raced) throw new AppError("CONFLICT", "Transaction admission changed concurrently");
    assertJournalScope(raced, current, input.kind, signer);
    return { created: false, receipt: { outcome: raced.outcome, ledger: raced.ledger } };
  });
  if (admission.created) captureTransactionSigned(row);
  return {
    tx,
    signer,
    replay: !admission.created,
    ...(admission.receipt ? { receipt: admission.receipt } : {}),
  };
}
