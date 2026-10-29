import { AppError } from "@/lib/errors";
import type { ApiCredentialAuth } from "./auth";

/** Exhaustive operation matrix. POST reconciliation is an operation, despite returning state.
 * Missing/unknown entries fail closed even when JavaScript bypasses the TypeScript contract. */
export const V1_PERMISSIONS = {
  "GET balances": "read",
  "GET capabilities": "read",
  "GET events": "read",
  "GET funding": "read",
  "GET schedule/state": "read",
  "GET subscription/state": "read",
  "GET swap-quote": "read",
  "GET transactions/:txHash": "read",
  "POST execute": "operate",
  "POST execute/submit": "operate",
  "POST funding": "operate",
  "POST funding/reconcile": "operate",
  "POST funding/submit": "operate",
  "POST release-early": "operate",
  "POST schedule/pause": "operate",
  "POST schedule/pause/reconcile": "operate",
  "POST schedule/pause/submit": "operate",
  "POST schedule/resume": "operate",
  "POST schedule/resume/reconcile": "operate",
  "POST schedule/resume/submit": "operate",
  "POST schedule/retrieve": "operate",
  "POST schedule/retrieve/reconcile": "operate",
  "POST schedule/retrieve/submit": "operate",
  "POST subscription/cancel/prepare": "operate",
  "POST subscription/cancel/reconcile": "operate",
  "POST subscription/cancel/submit": "operate",
  "POST subscription/reactivate/prepare": "operate",
  "POST subscription/reactivate/reconcile": "operate",
  "POST subscription/reactivate/submit": "operate",
  "GET deployments": "read",
} as const;
export type V1Operation = keyof typeof V1_PERMISSIONS;
export function assertApiPermission(auth: ApiCredentialAuth, operation: V1Operation) {
  if (!Object.hasOwn(V1_PERMISSIONS, operation))
    throw new AppError("FORBIDDEN", "API operation has no declared permission");
  if (
    auth.tokenType === "developer_token" &&
    auth.token.permission === "READ_ONLY" &&
    V1_PERMISSIONS[operation] !== "read"
  )
    throw new AppError("FORBIDDEN", "This API token has read-only access");
}
