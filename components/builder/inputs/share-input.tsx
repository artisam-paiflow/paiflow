"use client";

import { TOTAL_BPS } from "@/lib/flows/schema";
import { formatPercent, PercentBpsInput, type PercentBpsInputProps } from "./percent-bps-input";

type Props = PercentBpsInputProps & {
  /**
   * What is left of 100% for this field once every *other* share is counted.
   * When given, the field shows the remainder after its own value and flags
   * an over-allocation as its error. Omit it for a lone percentage (a swap's
   * max slippage), which then renders no remainder line.
   */
  remainingBps?: number;
};

/** A percentage stored as basis points, optionally one share of a 100% total. */
export function ShareInput({ remainingBps, hint, error, ...rest }: Props) {
  if (remainingBps === undefined) {
    return <PercentBpsInput {...rest} hint={hint} error={error} />;
  }

  const left = remainingBps - rest.value;
  const overBy = left < 0 ? -left : 0;
  const remainder = overBy ? null : `${formatPercent(left)} left of 100%.`;
  const overError = overBy
    ? `Over-allocated by ${formatPercent(overBy)}: the shares add up to ${formatPercent(TOTAL_BPS + overBy)}.`
    : null;

  return (
    <PercentBpsInput
      {...rest}
      hint={
        hint || remainder ? (
          <>
            {hint}
            {hint && remainder ? " " : null}
            {remainder}
          </>
        ) : undefined
      }
      error={error ?? overError}
    />
  );
}
