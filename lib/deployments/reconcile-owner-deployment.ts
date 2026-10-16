import "server-only";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { TemplateKind, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { sorobanRpc } from "@/lib/stellar/client";
import { confirmDeployment } from "./confirm";
import { recoveredDeploymentReferences } from "./deployment-recovery";

type Deployment = Prisma.DeploymentGetPayload<{
  include: { flow: { select: { templateKind: true } } };
}>;

/** Reconcile one owned, already submitted deployment. Never submit or infer failure from age. */
export async function reconcileOwnerDeployment(deployment: Deployment): Promise<void> {
  const d = deployment;
  if (
    d.serviceState !== "ACTIVE" ||
    !["SUBMITTED", "FAILED"].includes(d.status) ||
    d.network !== env().STELLAR_NETWORK ||
    !d.deployTxHash ||
    !d.unsignedXdr ||
    !d.sourceAccount
  )
    return;

  let source: string;
  try {
    const prepared = TransactionBuilder.fromXDR(d.unsignedXdr, stellarPassphrase());
    if (
      !(prepared instanceof Transaction) ||
      prepared.signatures.length !== 0 ||
      prepared.hash().toString("hex") !== d.deployTxHash ||
      prepared.source !== d.sourceAccount
    )
      return;
    source = prepared.source;
  } catch {
    return;
  }

  // The submit route persists this binding before sending. A missing or unrelated
  // signer row cannot authorize repair, even if a public hash has succeeded.
  const signed = await db.signedTransaction.findFirst({
    where: {
      txHash: d.deployTxHash,
      deploymentId: d.id,
      userId: d.ownerId,
      kind: "DEPLOY",
      network: d.network,
      signerAddress: source,
    },
    select: { txHash: true },
  });
  if (!signed) return;
  const parsedGraph = FlowGraphSchema.safeParse(d.graphSnapshot);
  if (!parsedGraph.success) return;
  const triggers = parsedGraph.data.nodes.filter(isTrigger);
  if (triggers.length !== 1 || !Array.isArray(d.paramsSnapshot)) return;
  const first = d.paramsSnapshot[0];
  if (
    !first ||
    typeof first !== "object" ||
    Array.isArray(first) ||
    typeof first.templateKind !== "string" ||
    !Object.values(TemplateKind).includes(first.templateKind as TemplateKind)
  )
    return;
  const historicalKind =
    triggers[0]!.type === "payroll"
      ? TemplateKind.PAYROLL
      : triggers[0]!.type === "subscription"
        ? TemplateKind.SUBSCRIPTION
        : (first.templateKind as TemplateKind);
  if (
    !["payroll", "subscription"].includes(triggers[0]!.type) &&
    [TemplateKind.PAYROLL, TemplateKind.SUBSCRIPTION, TemplateKind.SUBSCRIPTION_DEV].some(
      (kind) => kind === historicalKind,
    )
  )
    return;

  if (
    triggers[0]!.type === "subscription" &&
    !["SUBSCRIPTION", "SUBSCRIPTION_DEV"].includes(first.templateKind)
  )
    return;
  if (
    triggers[0]!.type === "payroll" &&
    !["PAYROLL", "SUBSCRIPTION", "SUBSCRIPTION_DEV"].includes(first.templateKind)
  )
    return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let got;
  try {
    got = await Promise.race([
      sorobanRpc().getTransaction(d.deployTxHash),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Deployment status RPC deadline")), 3_000);
      }),
    ]);
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }

  if (got.status === "SUCCESS") {
    // Factory results must prove every durable pipeline address, in order.
    if (got.returnValue?.switch().name !== "scvVec") return;
    let references;
    try {
      references = recoveredDeploymentReferences(d, got);
      // This owner poll confirms a complete durable plan; repairing malformed
      // or absent pipeline metadata requires the separate verified recovery path.
      if (references.pipelineSnapshot) return;
    } catch {
      return;
    }
    await confirmDeployment(
      { ...d, flow: { templateKind: historicalKind } },
      { txHash: d.deployTxHash, contractAddress: references.contractAddress },
      source,
      true,
    );
    await recordTransactionOutcome(d.deployTxHash, "CONFIRMED", {
      deploymentId: d.id,
      ledger: got.ledger,
    });
  } else if (got.status === "FAILED") {
    const changed = await db.deployment.updateMany({
      where: { id: d.id, ownerId: d.ownerId, status: "SUBMITTED", deployTxHash: d.deployTxHash },
      data: { status: "FAILED", errorMessage: "Transaction failed on the network" },
    });
    if (changed.count || d.status === "FAILED")
      await recordTransactionOutcome(d.deployTxHash, "FAILED", {
        deploymentId: d.id,
        ledger: got.ledger,
        failureCode: "ONCHAIN_FAILED",
      });
  }
}
