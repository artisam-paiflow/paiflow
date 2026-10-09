import { AppError } from "@/lib/errors";

export type PayoutPayment = { amountStroops: string; percentageBps: number };
const invalid = (message: string) => new AppError("VALIDATION", message);

export function requirePayConsumesAll(incoming: string, payment: PayoutPayment): void {
  const amount = BigInt(incoming);
  const configured = BigInt(payment.amountStroops);
  const bps = payment.percentageBps;
  if (amount <= 0n || configured < 0n || !Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw invalid("Invalid payout payment configuration");
  if (bps > 0 && amount * BigInt(bps) > (1n << 127n) - 1n)
    throw invalid("Percentage payment multiplication exceeds the contract i128 range");
  const paid =
    bps > 0 ? (amount * BigInt(bps)) / 10000n : amount < configured ? amount : configured;
  if (paid !== amount)
    throw invalid(
      "This incoming amount would leave funds in Pay; use 100% or a fixed cap at least as large as the incoming amount",
    );
}

export function splitPayoutRemainder(
  incoming: string,
  totalFixed: string,
  accumulated: string,
  balance: string,
): string {
  if (BigInt(balance) !== 0n || BigInt(accumulated) !== 0n)
    throw invalid(
      "Upstream Split has pooled funds; per-payment payouts require zero token and accumulated balances",
    );
  const total = BigInt(totalFixed);
  if (total <= 0n)
    throw invalid("A percentage Split consumes the deposit and does not fund the selected Pay");
  const remainder = BigInt(incoming) - total;
  if (remainder <= 0n)
    throw invalid(
      "This deposit accumulates in Split or is consumed by its recipients and does not reach the selected Pay",
    );
  // Both splitter variants forward the token surplus and reset accumulated_balance to zero.
  return remainder.toString();
}
