import { FIAT_PAYOUT_TRIGGERS } from "@/lib/flows/validate";

export function fiatPayoutAvailable(offrampEnabled: boolean, triggerType: string | null): boolean {
  if (!offrampEnabled) return false;
  return (
    triggerType === "payroll" || (triggerType !== null && FIAT_PAYOUT_TRIGGERS.has(triggerType))
  );
}
/**
 * Whether to render the payout-mode selector. Beyond `available`, a step saved
 * with fiat while the off-ramp is switched off keeps the selector, so the user
 * can move it back to crypto instead of deleting the step.
 */
export function showPayoutModeSelect(
  available: boolean,
  offrampEnabled: boolean,
  payoutMode: string | undefined,
): boolean {
  return available || (!offrampEnabled && payoutMode === "fiat");
}
