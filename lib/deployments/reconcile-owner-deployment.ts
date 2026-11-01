import "server-only";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { TemplateKind, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { recordTransactionOutcome } from "@/lib/analytics/outcomes";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import { assertSignedWalletTransaction } from "@/lib/stellar/wallet-signature";
import { sorobanRpc } from "@/lib/stellar/client";
import { confirmDeployment } from "./confirm";
import { recoveredDeploymentReferences } from "./deployment-recovery";
type Deployment = Prisma.DeploymentGetPayload<{
  include: {
    flow: {
      select: {
        templateKind: true;
      };
    };
  };
}>;
/** Reconcile one owned, already submitted deployment. Never submit or infer failure from age. */
export async function reconcileOwnerDeployment(
  deployment: Deployment,
  settlement = false,
): Promise<void> {
  let d = deployment;
  // A template instance already pins exact source/body identity at admission.
  // External signing infrastructure may broadcast it without this app's send
  // checkpoint. Only a real, exact source-signed RPC envelope can authorize that
  // instance-only recovery; ordinary deployment history keeps its original guard.
  const externalPrepared = Boolean(
    d.templateVersionId && d.preparedTxHash && d.status === "PENDING_SIGNATURE" && !d.deployTxHash,
  );
  const txHash = d.deployTxHash ?? (externalPrepared ? d.preparedTxHash : null);
  if (
    (d.serviceState !== "ACTIVE" && !(settlement && d.serviceState === "RETIRING")) ||
    (!["SUBMITTED", "FAILED"].includes(d.status) && !externalPrepared) ||
    d.network !== env().STELLAR_NETWORK ||
    !txHash ||
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
      prepared.hash().toString("hex") !== txHash ||
      prepared.source !== d.sourceAccount
    )
      return;
    source = prepared.source;
  } catch {
    return;
  }
  // Ordinary deployments require the pre-submit signer binding. A template
  // instance with no such row must prove the exact actual envelope below.
  const signed = await db.signedTransaction.findFirst({
    where: {
      txHash,
      deploymentId: d.id,
      ...(d.templateVersionId
        ? { OR: [{ userId: d.ownerId }, { developerApiToken: { ownerId: d.ownerId } }] }
        : { userId: d.ownerId }),
      kind: "DEPLOY",
      network: d.network,
      signerAddress: source,
    },
    select: { txHash: true },
  });
  if (!signed && !d.templateVersionId) return;
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
    triggers[0]!.type === "subscription"
      ? TemplateKind.SUBSCRIPTION
      : (first.templateKind as TemplateKind);
  if (triggers[0]!.type !== "subscription" && historicalKind === TemplateKind.SUBSCRIPTION) return;
  if (triggers[0]!.type === "subscription" && first.templateKind !== "SUBSCRIPTION") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let got;
  try {
    got = await Promise.race([
      sorobanRpc().getTransaction(txHash),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Deployment status RPC deadline")), 3000);
      }),
    ]);
  } catch {
    return;
  } finally {
    clearTimeout(timer);
  }
  if (!signed) {
    if (
      !d.templateVersionId ||
      !["SUCCESS", "FAILED"].includes(got.status) ||
      !d.unsignedXdr ||
      !d.sourceAccount
    )
      return;
    try {
      if (got.status !== "SUCCESS" && got.status !== "FAILED") return;
      const observed = TransactionBuilder.fromXDR(got.envelopeXdr, stellarPassphrase());
      if (
        !(observed instanceof Transaction) ||
        observed.toEnvelope().switch().name !== "envelopeTypeTx" ||
        observed.hash().toString("hex") !== txHash
      )
        return;
      assertSignedWalletTransaction(
        d.unsignedXdr,
        observed.toXDR(),
        d.sourceAccount,
        stellarPassphrase(),
      );
    } catch {
      return;
    }
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
    if (externalPrepared) {
      const claimed = await db.deployment.updateMany({
        where: {
          id: d.id,
          ownerId: d.ownerId,
          status: "PENDING_SIGNATURE",
          deployTxHash: null,
          preparedTxHash: txHash,
          unsignedXdr: d.unsignedXdr,
        },
        data: { status: "SUBMITTED", deployTxHash: txHash },
      });
      if (!claimed.count) return;
      d = { ...d, status: "SUBMITTED", deployTxHash: txHash };
    }
    await confirmDeployment(
      { ...d, flow: { templateKind: historicalKind } },
      { txHash, contractAddress: references.contractAddress },
      source,
      true,
    );
    await recordTransactionOutcome(txHash, "CONFIRMED", {
      deploymentId: d.id,
      ledger: got.ledger,
    });
  } else if (got.status === "FAILED") {
    if (externalPrepared) {
      await db.deployment.updateMany({
        where: {
          id: d.id,
          ownerId: d.ownerId,
          status: "PENDING_SIGNATURE",
          deployTxHash: null,
          preparedTxHash: txHash,
          unsignedXdr: d.unsignedXdr,
        },
        data: {
          status: "FAILED",
          deployTxHash: txHash,
          errorMessage: "The exact prepared instance failed on the network",
        },
      });
      return;
    }
    const changed = await db.deployment.updateMany({
      where: { id: d.id, ownerId: d.ownerId, status: "SUBMITTED", deployTxHash: txHash },
      data: { status: "FAILED", errorMessage: "Transaction failed on the network" },
    });
    if (changed.count || d.status === "FAILED")
      await recordTransactionOutcome(txHash, "FAILED", {
        deploymentId: d.id,
        ledger: got.ledger,
        failureCode: "ONCHAIN_FAILED",
      });
  }
}
