import { TOTAL_BPS } from "@/lib/flows/primitives";

/**
 * The shares a split lands on when switched to percentage mode. `cached[i]` is
 * the share recipient `i` had the last time the split was in percentage mode,
 * or `undefined` if it never had one. Cached shares come back as they were;
 * the rest split what those leave of 100% evenly, in whole basis points, with
 * the remainder going one bp each to the first of them. So a split that never
 * had shares starts at a valid 100% rather than every share at 0 (#583).
 *
 * When the cached shares already use 100% or more, the new recipients get 0,
 * which the panel shows and `validateFlow` refuses before deploy.
 */
export function defaultShares(cached: readonly (number | undefined)[]): number[] {
  const used = cached.reduce<number>((s, bps) => s + (bps ?? 0), 0);
  const fresh = cached.filter((bps) => bps === undefined).length;
  const left = Math.max(0, TOTAL_BPS - used);
  const each = fresh > 0 ? Math.floor(left / fresh) : 0;
  let extra = fresh > 0 ? left % fresh : 0;
  return cached.map((bps) => {
    if (bps !== undefined) return bps;
    if (extra > 0) {
      extra -= 1;
      return each + 1;
    }
    return each;
  });
}
