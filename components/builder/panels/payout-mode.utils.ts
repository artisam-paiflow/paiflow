import { FIAT_PAYOUT_TRIGGERS } from "@/lib/flows/validate";

/**
 * Whether a pay step or split recipient may be switched to fiat payout: the
 * off-ramp is on for this server (#722), and the trigger routes payouts through
 * a contract that can sink a cash-out share. Payroll allows it in dev mode too,
 * with bank details filled via the API after deploy.
 */
export function fiatPayoutAvailable(
  offrampEnabled: boolean,
  triggerType: string | null,
  devMode: boolean,
): boolean {
  if (!offrampEnabled) return false;
  return (
    triggerType === "payroll" ||
    (!devMode && triggerType !== null && FIAT_PAYOUT_TRIGGERS.has(triggerType))
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
