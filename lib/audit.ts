import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { log } from "./log";

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "SANDBOX_CREATE"
  | "USER_UPDATE"
  | "USER_PASSWORD_CHANGE"
  | "USER_PASSWORD_RESET_REQUEST"
  | "USER_PASSWORD_RESET_COMPLETE"
  | "USER_SESSIONS_REVOKED"
  | "PASSKEY_ADD"
  | "PASSKEY_REMOVE"
  | "WALLET_CONNECT"
  | "FLOW_CREATE"
  | "FLOW_UPDATE"
  | "FLOW_DELETE"
  | "DEPLOY_PREPARE"
  | "DEPLOY_SUBMIT"
  | "DEPLOY_CONFIRM"
  | "DEPLOY_FAIL"
  | "DEPLOY_TRIGGER"
  | "DEPLOY_TRIGGER_CONFIRMED"
  | "DEPLOY_INVOKE"
  | "DEPLOY_AMOUNT_CHANGE"
  | "DEPLOY_DEV_PAYROLL"
  | "DEV_UPDATE_PAYMENT"
  | "DEV_UPDATE_RECIPIENTS"
  | "DEV_UPDATE_SUBSCRIPTION"
  | "DEV_UPDATE_BANK"
  | "ADMIN_USER_CREATE"
  | "ADMIN_USER_UPDATE"
  | "ADMIN_USER_DEACTIVATE"
  | "API_TOKEN_CREATED"
  | "API_TOKEN_REVOKED"
  | "API_EXECUTE_PREPARED"
  | "API_EXECUTE_SUBMITTED"
  | "API_EXECUTE_CONFIRMED";

/**
 * The actions whose metadata carries `{ deploymentId, txHash }` for a transaction
 * this app submitted on a deployment's behalf: `submit-trigger` (DEPLOY_TRIGGER),
 * `submit-invoke` (DEPLOY_INVOKE), `submit` (DEPLOY_CONFIRM) and the partner API's
 * `/api/v1/deployments/:id/execute/submit` (API_EXECUTE_SUBMITTED).
 *
 * `satisfies` rather than a plain array so renaming a member of the union above
 * is a type error here, instead of a list that silently stops matching.
 */
const SUBMITTED_TX_ACTIONS = [
  "DEPLOY_TRIGGER",
  "DEPLOY_INVOKE",
  "DEPLOY_CONFIRM",
  "API_EXECUTE_SUBMITTED",
] satisfies AuditAction[];

/**
 * Did this app submit `txHash` for `deploymentId`? Used to decide whether a
 * status poll may run the deployment-specific bookkeeping that follows a
 * confirmation — not to decide whether the caller may read the status, which is
 * public chain data.
 *
 * The audit row is a best-effort write (see `audit` below), so a false here can
 * mean "we lost the row" as well as "not ours". That is why callers must treat
 * it as permission for an optimisation, never as the only thing standing
 * between a caller and a correct answer.
 */
export async function wasTxSubmittedFor(deploymentId: string, txHash: string): Promise<boolean> {
  const row = await db.auditLog.findFirst({
    where: {
      action: { in: SUBMITTED_TX_ACTIONS },
      AND: [
        { metadata: { path: ["deploymentId"], equals: deploymentId } },
        { metadata: { path: ["txHash"], equals: txHash } },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

export async function audit(opts: {
  action: AuditAction;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await db.auditLog.create({
      data: {
        action: opts.action,
        userId: opts.userId ?? null,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        metadata: opts.metadata,
      },
    });
  } catch (err) {
    log.warn({ err, action: opts.action }, "audit write failed");
  }
}
