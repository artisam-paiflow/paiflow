import type {
  ApiResponse,
  ContractEventItem,
  FundingPrepared,
  PaiflowDeployment,
  PreparedSigner,
  SchedulePrepared,
  SubscriptionPrepared,
  AllowancePrepared,
  AllowanceState,
  WebhookTriggerInput,
} from "@paiflow/sdk";

// App-owned, durable restricted journal. Persist preparation BEFORE wallet consent,
// signed submission BEFORE sending, and receipts/checkpoints without sensitive logs.
export type Journal = (key: string, value: unknown) => Promise<void>;
export async function fund(
  flow: PaiflowDeployment,
  nodeId: string,
  walletAddress: string,
  amountStroops: string,
  signer: PreparedSigner,
  save: Journal,
) {
  const discovery = await flow.funding.get();
  const node = discovery.data.nodes.find((node) => node.nodeId === nodeId);
  if (!node) throw new Error("Unsupported funding node");
  const p = await flow.funding.prepare({
    nodeId,
    fromAddress: walletAddress,
    tokenContractAddress: node.tokenContractAddress,
    amountStroops,
  });
  await save(p.data.intent, p);
  const signed = await flow.funding.signPrepared(p, signer, {
    walletAddress,
    expectedNetwork: discovery.data.network,
  });
  await save(p.data.intent, signed);
  return flow.funding.submit(signed.submission, signed.submissionOptions);
}
export function recoverFunding(flow: PaiflowDeployment, p: ApiResponse<FundingPrepared>) {
  // No replacementAllowed in this protocol; retain original intent/hash.
  return flow.funding.reconcile({ action: p.data.action, intent: p.data.intent });
}
export async function pauseSchedule(
  flow: PaiflowDeployment,
  nodeId: string,
  controller: string,
  signer: PreparedSigner,
  save: Journal,
) {
  const state = await flow.schedule.get({ nodeId });
  if (state.data.controller !== controller || !state.data.controlEligibility.pause)
    throw new Error("Controller cannot pause this Schedule");
  const p = await flow.schedule.pause.prepare({ nodeId, walletAddress: controller });
  await save(p.data.intent, p);
  const signed = await flow.schedule.pause.signPrepared(p, signer, { walletAddress: controller });
  await save(p.data.intent, signed);
  return flow.schedule.pause.submit(signed.submission, signed.submissionOptions);
}
export function recoverPause(flow: PaiflowDeployment, p: ApiResponse<SchedulePrepared<"pause">>) {
  return flow.schedule.pause.reconcile({ intent: p.data.intent });
}
export async function cancelSubscription(
  flow: PaiflowDeployment,
  subscriber: string,
  signer: PreparedSigner,
  save: Journal,
) {
  const p = await flow.subscription.cancel.prepare({ walletAddress: subscriber });
  await save(p.data.intent, p);
  const signed = await flow.subscription.cancel.signPrepared(p, signer, {
    walletAddress: subscriber,
  });
  await save(p.data.intent, signed);
  return flow.subscription.cancel.submit(signed.submission, signed.submissionOptions);
}
export function recoverCancellation(
  flow: PaiflowDeployment,
  p: ApiResponse<SubscriptionPrepared<"subscription.cancel">>,
) {
  return flow.subscription.cancel.reconcile({ intent: p.data.intent });
}
export async function approveAllowance(
  flow: PaiflowDeployment,
  subscriber: string,
  amount: string,
  signer: PreparedSigner,
  save: Journal,
) {
  const state: ApiResponse<AllowanceState> = await flow.subscription.allowance.get();
  const p: ApiResponse<AllowancePrepared> = await flow.subscription.allowance.prepare({
    userAddress: subscriber,
    amount,
  });
  await save(p.data.txHash, { state, preparation: p });
  // Explicit public state snapshot is required; approval ADDS to existing allowance.
  const signed = await flow.subscription.allowance.signPrepared(p, state, signer, {
    walletAddress: subscriber,
  });
  await save(p.data.txHash, signed);
  return flow.subscription.allowance.submit(signed.submission, signed.submissionOptions);
}
export function recoverAllowance(flow: PaiflowDeployment, p: ApiResponse<AllowancePrepared>) {
  return flow.subscription.allowance.status({ intent: p.data.intent });
}
export async function reward(
  flow: PaiflowDeployment,
  original: {
    key: string;
    input: WebhookTriggerInput;
  },
  webhookSecret: string,
  save: Journal,
) {
  // Authenticate your application's operator/event BEFORE entering this function.
  // Recover using this SAME previously persisted key and arguments, never a new key.
  await save(original.key, original.input);
  const receipt = await flow.webhook.trigger(original.input, {
    webhookSecret,
    idempotencyKey: original.key,
  });
  await save(original.key, receipt);
  return receipt; // PENDING/UNKNOWN are unresolved; no fallback to unkeyed callback
}
export async function ingestEvents(
  flow: PaiflowDeployment,
  cursor: string | undefined,
  txHash: string | undefined,
  commit: (
    events: ContractEventItem[],
    checkpoint: {
      cursor: string | null;
      hasMore: boolean;
    },
  ) => Promise<void>,
  signal?: AbortSignal,
) {
  for await (const page of flow.events.pages(
    { cursor, txHash, limit: 50 },
    { maxPages: 10, signal },
  )) {
    // Your DB commits events (unique eventId) AND checkpoint atomically. Restart
    // uses persisted cursor/filter; page cap is not proof history is complete.
    await commit(page.data.items, { cursor: page.data.nextCursor, hasMore: page.data.hasMore });
  }
}
