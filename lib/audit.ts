import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { log } from "./log";

export type AuditAction =
  | "USER_LOGIN"
  | "USER_LOGIN_FAILED"
  | "USER_LOGOUT"
  | "USER_REGISTER"
  | "USER_UPDATE"
  | "USER_PASSWORD_CHANGE"
  | "USER_PASSWORD_RESET_REQUEST"
  | "USER_PASSWORD_RESET_COMPLETE"
  | "USER_SESSIONS_REVOKED"
  | "PASSKEY_ADD"
  | "PASSKEY_REMOVE"
  | "FLOW_CREATE"
  | "FLOW_UPDATE"
  | "FLOW_DELETE"
  | "DEPLOY_PREPARE"
  | "DEPLOY_SUBMIT"
  | "DEPLOY_CONFIRM"
  | "DEPLOY_FAIL"
  | "ADMIN_USER_CREATE"
  | "ADMIN_USER_UPDATE"
  | "ADMIN_USER_DEACTIVATE";

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
