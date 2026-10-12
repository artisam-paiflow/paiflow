import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
export const BalancePipelineSchema = BalancePipelineSnapshotSchema;

export const BALANCE_KINDS = new Set([
  "STREAMER",
  "WEBHOOK",
  "TIMELOCK",
  "TIMELOCK_BRANCH",
  "CONDITIONAL",
  "PAYER",
  "PAYER_DEV",
  "SPLITTER",
  "SPLITTER_DEV",
  "SWAPPER",
]);
export const NON_HOLDING_KINDS = new Set([
  "DEPOSIT_TRIGGER",
  "SUBSCRIPTION",
  "SUBSCRIPTION_DEV",
  "ROUTER",
  "ORACLE",
]);
export function balanceCandidates(snapshot: unknown, devEnabled: boolean) {
  const parsed = BalancePipelineSchema.safeParse(snapshot);
  if (!parsed.success) return [];
  const candidates = parsed.data.filter(
    (n) => BALANCE_KINDS.has(n.templateKind) && (devEnabled || !n.templateKind.endsWith("_DEV")),
  );
  return candidates.length <= 64 ? candidates : [];
}
