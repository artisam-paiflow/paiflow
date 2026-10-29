/** Balance/eligibility changes shared by ingestion and the owner dashboard. */
export function changesDashboardBalance(kind: string): boolean {
  return [
    "RECEIVE",
    "PAYOUT",
    "CLAIM",
    "CANCEL",
    "SHORTFALL",
    "FORWARD",
    "RETRIEVE",
    "ALLOWANCE",
  ].includes(kind);
}
