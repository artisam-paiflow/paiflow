/** Stable identifiers for the rules that carry one. Match on these, not on prose. */
export type SwapIssueCode =
  | "SWAP_SAME_ASSET"
  | "SWAP_SLIPPAGE_TOO_LOW"
  | "SWAP_NEEDS_NEXT_STEP"
  | "SWAP_SINGLE_EDGE"
  | "SWAP_ASSET_NOT_SUPPORTED";

export type ValidationIssueCode = SwapIssueCode;

/**
 * One validation finding. `path` is the wire key and the analytics grouping
 * key (`validationErrorKey`), so it never changes for an existing rule;
 * `code`, `nodeId` and `field` are optional and additive.
 */
export type ValidationIssue = {
  path: string;
  message: string;
  friendlyMessage: string;
  code?: ValidationIssueCode;
  nodeId?: string;
  /** The config field under `nodes.<id>.config`, when the issue has one. */
  field?: string;
};
