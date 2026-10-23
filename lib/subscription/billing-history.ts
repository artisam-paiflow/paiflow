import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { EventKind, type Prisma, type TemplateKind } from "@prisma/client";
import { db } from "@/lib/db";
import { pipelineNodesOfKind } from "@/lib/pipeline-snapshot";

const MAX_I128 = (1n << 127n) - 1n;
export const BILLING_HISTORY_EVENT_BATCH = 100;

/** Payroll has its own financial records, even when its trigger is a Subscription. */
export function subscriptionBillingEmitter(
  snapshot: unknown,
  flowKind: TemplateKind,
): string | null {
  if (flowKind === "PAYROLL") return null;
  const nodes = [
    ...pipelineNodesOfKind(snapshot, "SUBSCRIPTION"),
    ...pipelineNodesOfKind(snapshot, "SUBSCRIPTION_DEV"),
  ];
  if (nodes.length !== 1 || !StrKey.isValidContract(nodes[0]!.contractAddress)) return null;
  const address = nodes[0]!.contractAddress;
  // An ambiguous snapshot must not attribute another node's event to a subscription.
  return Array.isArray(snapshot) &&
    snapshot.filter(
      (node: unknown) =>
        !!node &&
        typeof node === "object" &&
        "contractAddress" in node &&
        node.contractAddress === address,
    ).length === 1
    ? address
    : null;
}

type HistoryEvent = {
  deploymentId: string;
  kind: EventKind;
  ledger: number;
  txHash: string;
  payload: unknown;
  occurredAt: Date;
};

function isCharge(event: HistoryEvent, emitter: string): boolean {
  if (
    event.kind !== EventKind.RECEIVE ||
    !Number.isInteger(event.ledger) ||
    event.ledger <= 0 ||
    !/^[0-9a-f]{64}$/i.test(event.txHash) ||
    !(event.occurredAt instanceof Date) ||
    !Number.isFinite(event.occurredAt.getTime()) ||
    !event.payload ||
    typeof event.payload !== "object"
  )
    return false;
  const payload = event.payload as Record<string, unknown>;
  const topics = payload.topics;
  const value = payload.value;
  return (
    payload.contractAddress === emitter &&
    // Older getEvents rows omit this deprecated marker. An explicit failure
    // remains unusable; current RPC contract streams contain committed events.
    payload.inSuccessfulContractCall !== false &&
    Array.isArray(topics) &&
    topics.length === 2 &&
    topics[0] === "charge" &&
    typeof topics[1] === "string" &&
    (StrKey.isValidEd25519PublicKey(topics[1]) || StrKey.isValidContract(topics[1])) &&
    typeof value === "string" &&
    /^[1-9]\d{0,38}$/.test(value) &&
    BigInt(value) <= MAX_I128
  );
}

/** A projection of committed charge history, never proof to send another charge.
 * Ledger-close time is monotonic; mode/cancellation/configuration are independent.
 * Called inside existing event-poll admission, including retirement's cutoff scan.
 */
export async function projectSubscriptionCharge(
  event: HistoryEvent,
  emitter: string,
): Promise<void> {
  if (!isCharge(event, emitter)) return;
  await db.deployment.updateMany({
    where: {
      id: event.deploymentId,
      serviceState: { not: "RETIRED" },
      OR: [{ lastChargedAt: null }, { lastChargedAt: { lt: event.occurredAt } }],
    },
    data: { lastChargedAt: event.occurredAt },
  });
}

/** Repair an already-advanced cursor from retained evidence, including MANUAL or
 * cancelled subscriptions. Filtering by emitter/topic keeps unrelated later events
 * out of this bounded latest-first pass. Only the maximum valid time is needed.
 */
export async function reconcileStoredSubscriptionCharges(opts: {
  deploymentId: string;
  emitter: string;
  cutoff?: number;
}): Promise<void> {
  const events = await db.contractEvent.findMany({
    where: {
      deploymentId: opts.deploymentId,
      kind: EventKind.RECEIVE,
      ...(opts.cutoff === undefined ? {} : { ledger: { lte: opts.cutoff } }),
      AND: [
        { payload: { path: ["contractAddress"], equals: opts.emitter } },
        { payload: { path: ["topics", "0"], equals: "charge" } },
      ],
    },
    orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }],
    take: BILLING_HISTORY_EVENT_BATCH,
    select: {
      deploymentId: true,
      kind: true,
      ledger: true,
      txHash: true,
      payload: true,
      occurredAt: true,
    },
  });
  const latest = events.find((event) => isCharge(event, opts.emitter));
  if (latest) await projectSubscriptionCharge(latest, opts.emitter);
}

/** CAS fences a stale RPC observation against every schedule/config/lifecycle
 * writer. The database trigger advances this revision even for same-value writes.
 */
export async function refreshSubscriptionSchedule(
  id: string,
  revision: number,
  data: Pick<Prisma.DeploymentUpdateManyMutationInput, "nextChargeAt" | "chargeRelayerMode">,
): Promise<void> {
  await db.deployment.updateMany({
    where: { id, serviceState: "ACTIVE", chargeScheduleRevision: revision },
    data,
  });
}
