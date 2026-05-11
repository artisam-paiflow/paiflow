import "server-only";
import { db } from "./db";
import { log } from "./log";

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "USER_UPDATE"
  | "PASSKEY_ADD"
  | "PASSKEY_REMOVE"
  | "FLOW_CREATE"
  | "FLOW_UPDATE"
  | "FLOW_DELETE"
  | "DEPLOY_PREPARE"
  | "DEPLOY_SUBMIT"
  | "DEPLOY_CONFIRM"
  | "DEPLOY_FAIL";

export async function audit(opts: {
  action: AuditAction;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.auditLog.create({
      data: {
        action: opts.action,
        userId: opts.userId ?? null,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        metadata: opts.metadata ?? undefined,
      },
    });
  } catch (err) {
    log.warn({ err, action: opts.action }, "audit write failed");
  }
}
