import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
export const BalancePipelineSchema = BalancePipelineSnapshotSchema;
export const BALANCE_KINDS = new Set([
  "STREAMER",
  "WEBHOOK",
  "TIMELOCK",
  "TIMELOCK_BRANCH",
  "CONDITIONAL",
  "PAYER",
  "SPLITTER",
  "SWAPPER",
]);
export const NON_HOLDING_KINDS = new Set(["DEPOSIT_TRIGGER", "SUBSCRIPTION", "ROUTER", "ORACLE"]);
export function balanceCandidates(snapshot: unknown) {
  const parsed = BalancePipelineSchema.safeParse(snapshot);
  if (!parsed.success) return [];
  const candidates = parsed.data.filter((n) => BALANCE_KINDS.has(n.templateKind));
  return candidates.length <= 64 ? candidates : [];
}
