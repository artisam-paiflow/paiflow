import "server-only";
import crypto from "node:crypto";
import { Role, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import type { AuditAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  MAX_ACTIVE_DEVELOPER_TOKENS,
  type CreateDeveloperToken,
  type DeveloperTokenListQuery,
} from "./schema";

export const DEVELOPER_TOKEN_SELECT = {
  id: true,
  tokenPrefix: true,
  label: true,
  permission: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  grants: { select: { deploymentId: true }, orderBy: { deploymentId: "asc" as const } },
} as const;
type TokenRow = Prisma.DeveloperApiTokenGetPayload<{ select: typeof DEVELOPER_TOKEN_SELECT }>;
export function developerTokenMetadata(row: TokenRow) {
  const { grants, ...metadata } = row;
  return { ...metadata, deploymentIds: grants.map((grant) => grant.deploymentId) };
}
export async function requireDeveloperTokenManager(write = false) {
  const user = await requireSession();
  if (user.role === Role.SANDBOX) throw new AppError("FORBIDDEN", "Not available in the sandbox");
  if (write)
    await enforceRateLimit({ key: `developer-tokens:${user.id}`, limit: 30, windowSeconds: 60 });
  return user;
}
export function generateDeveloperApiToken() {
  const plaintext = `pfd_${crypto.randomBytes(32).toString("hex")}`;
  return { plaintext, tokenHash: hashApiToken(plaintext), tokenPrefix: plaintext.slice(0, 12) };
}
export function activeDeveloperTokenFilter(now: Date) {
  return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}
async function lockOwner(tx: Prisma.TransactionClient, ownerId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${ownerId}::uuid FOR NO KEY UPDATE`;
}
async function validateSelection(tx: Prisma.TransactionClient, ownerId: string, ids: string[]) {
  if (!ids.length) return;
  // Stable locking order avoids competing overlapping selections deadlocking. This
  // conflicts with retirement/status/owner updates until the grants commit.
  const eligible = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Deployment" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    AND "ownerId" = ${ownerId}::uuid AND status = 'CONFIRMED' AND "serviceState" = 'ACTIVE'
    ORDER BY id FOR SHARE`;
  if (eligible.length !== ids.length)
    throw new AppError("VALIDATION", "Select only your confirmed active deployments", {
      deploymentIds: ["One or more deployments are unavailable"],
    });
}
async function ownedToken(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  const token = await tx.developerApiToken.findFirst({
    where: { id, ownerId },
    select: DEVELOPER_TOKEN_SELECT,
  });
  if (!token) throw new AppError("NOT_FOUND", "Token not found");
  return token;
}
function auditData(
  req: NextRequest,
  ownerId: string,
  action: AuditAction,
  metadata: Prisma.InputJsonValue,
) {
  return {
    userId: ownerId,
    action,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
    metadata,
  };
}
export async function createDeveloperToken(
  ownerId: string,
  input: CreateDeveloperToken,
  req: NextRequest,
) {
  const { plaintext, tokenHash, tokenPrefix } = generateDeveloperApiToken();
  const row = await db.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const now = new Date();
    const count = await tx.developerApiToken.count({
      where: { ownerId, ...activeDeveloperTokenFilter(now) },
    });
    if (count >= MAX_ACTIVE_DEVELOPER_TOKENS)
      throw new AppError("CONFLICT", "Revoke an active developer token before creating another");
    await validateSelection(tx, ownerId, input.deploymentIds);
    const token = await tx.developerApiToken.create({
      data: {
        ownerId,
        tokenHash,
        tokenPrefix,
        label: input.label ?? null,
        permission: input.permission,
        expiresAt: input.expiresInDays
          ? new Date(now.getTime() + input.expiresInDays * 86_400_000)
          : null,
        grants: { create: input.deploymentIds.map((deploymentId) => ({ deploymentId })) },
      },
      select: DEVELOPER_TOKEN_SELECT,
    });
    await tx.auditLog.create({
      data: auditData(req, ownerId, "DEVELOPER_TOKEN_CREATED", {
        tokenId: token.id,
        permission: input.permission,
        deploymentIds: input.deploymentIds,
      }),
    });
    return token;
  });
  return { ...developerTokenMetadata(row), token: plaintext };
}
export async function inspectDeveloperToken(ownerId: string, id: string) {
  return developerTokenMetadata(await ownedToken(db, ownerId, id));
}
export async function updateDeveloperToken(
  ownerId: string,
  id: string,
  ids: string[],
  req: NextRequest,
) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const existing = await ownedToken(tx, ownerId, id);
    if (existing.revokedAt || (existing.expiresAt && existing.expiresAt <= new Date()))
      throw new AppError("CONFLICT", "Replace a revoked or expired token");
    await validateSelection(tx, ownerId, ids);
    await tx.developerTokenGrant.deleteMany({ where: { tokenId: id } });
    await tx.developerTokenGrant.createMany({
      data: ids.map((deploymentId) => ({ tokenId: id, deploymentId })),
    });
    await tx.auditLog.create({
      data: auditData(req, ownerId, "DEVELOPER_TOKEN_SELECTION_UPDATED", {
        tokenId: id,
        deploymentIds: ids,
      }),
    });
    return developerTokenMetadata(await ownedToken(tx, ownerId, id));
  });
}
export async function revokeDeveloperToken(ownerId: string, id: string, req: NextRequest) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const existing = await ownedToken(tx, ownerId, id);
    if (existing.revokedAt) return developerTokenMetadata(existing);
    const row = await tx.developerApiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: DEVELOPER_TOKEN_SELECT,
    });
    await tx.auditLog.create({
      data: auditData(req, ownerId, "DEVELOPER_TOKEN_REVOKED", { tokenId: id }),
    });
    return developerTokenMetadata(row);
  });
}
export async function listDeveloperTokens(ownerId: string, query: DeveloperTokenListQuery) {
  const rows = await db.developerApiToken.findMany({
    where: { ownerId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
    orderBy: { id: "asc" },
    take: query.limit + 1,
    select: DEVELOPER_TOKEN_SELECT,
  });
  const items = rows.slice(0, query.limit);
  return {
    items: items.map(developerTokenMetadata),
    nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
  };
}
export async function listEligibleDeployments(ownerId: string, query: DeveloperTokenListQuery) {
  const rows = await db.deployment.findMany({
    where: {
      ownerId,
      status: "CONFIRMED",
      serviceState: "ACTIVE",
      ...(query.cursor ? { id: { gt: query.cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: query.limit + 1,
    select: { id: true, network: true, flow: { select: { name: true } } },
  });
  const items = rows
    .slice(0, query.limit)
    .map((row) => ({ id: row.id, network: row.network, flowName: row.flow.name }));
  return { items, nextCursor: rows.length > query.limit ? items.at(-1)!.id : null };
}
