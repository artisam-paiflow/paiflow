import "server-only";
import crypto from "node:crypto";
import { Role, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import type { AuditAction } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { markTokenKnown } from "@/lib/api/v1/pre-auth";
import { AppError } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  CreateDeveloperTokenSchema,
  MAX_ACTIVE_DEVELOPER_TOKENS,
  MAX_DEVELOPER_TOKEN_GRANTS,
  type CreateDeveloperToken,
  type DeveloperTokenListQuery,
  type DeveloperTokenDeploymentQuery,
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
  templateGrants: { select: { templateId: true }, orderBy: { templateId: "asc" as const } },
  grants: { select: { deploymentId: true }, orderBy: { deploymentId: "asc" as const } },
} as const;
type TokenRow = Prisma.DeveloperApiTokenGetPayload<{
  select: typeof DEVELOPER_TOKEN_SELECT;
}>;
export function developerTokenMetadata(row: TokenRow) {
  const { grants, templateGrants, ...metadata } = row;
  return {
    ...metadata,
    deploymentIds: grants.map((grant) => grant.deploymentId),
    ...(templateGrants?.length
      ? { templateIds: templateGrants.map((grant) => grant.templateId) }
      : {}),
  };
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
  const eligible = await tx.$queryRaw<
    {
      id: string;
    }[]
  >`
    SELECT id FROM "Deployment" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    AND "ownerId" = ${ownerId}::uuid AND status = 'CONFIRMED' AND "serviceState" = 'ACTIVE'
    ORDER BY id FOR SHARE`;
  if (eligible.length !== ids.length)
    throw new AppError("VALIDATION", "Select only your confirmed active deployments", {
      deploymentIds: ["One or more deployments are unavailable"],
    });
}
async function validateTemplateSelection(
  tx: Prisma.TransactionClient,
  ownerId: string,
  ids: string[],
) {
  if (!ids.length) return;
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "FlowTemplate" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) AND "ownerId" = ${ownerId}::uuid AND "retiredAt" IS NULL ORDER BY id FOR SHARE`;
  if (rows.length !== ids.length)
    throw new AppError("VALIDATION", "Select only your active private templates", {
      templateIds: ["One or more templates are unavailable"],
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
  input = CreateDeveloperTokenSchema.parse(input);
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
    await validateTemplateSelection(tx, ownerId, input.templateIds ?? []);
    const token = await tx.developerApiToken.create({
      data: {
        ownerId,
        tokenHash,
        tokenPrefix,
        label: input.label ?? null,
        permission: input.permission,
        expiresAt: input.expiresInDays
          ? new Date(now.getTime() + input.expiresInDays * 86400000)
          : null,
        templateGrants: { create: (input.templateIds ?? []).map((templateId) => ({ templateId })) },
        grants: { create: input.deploymentIds.map((deploymentId) => ({ deploymentId })) },
      },
      select: DEVELOPER_TOKEN_SELECT,
    });
    await tx.auditLog.create({
      data: auditData(req, ownerId, "DEVELOPER_TOKEN_CREATED", {
        tokenId: token.id,
        permission: input.permission,
        deploymentIds: input.deploymentIds,
        templateIds: input.templateIds ?? [],
      }),
    });
    return token;
  });
  void markTokenKnown(tokenHash, row.expiresAt);
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
  templateIds?: string[],
) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const existing = await ownedToken(tx, ownerId, id);
    if (existing.revokedAt || (existing.expiresAt && existing.expiresAt <= new Date()))
      throw new AppError("CONFLICT", "Replace a revoked or expired token");
    if (
      ids.length +
        (templateIds ?? existing.templateGrants?.map((grant) => grant.templateId) ?? []).length >
      MAX_DEVELOPER_TOKEN_GRANTS
    )
      throw new AppError("VALIDATION", "Too many selected resources");
    await validateSelection(tx, ownerId, ids);
    if (templateIds !== undefined) {
      await validateTemplateSelection(tx, ownerId, templateIds);
      await tx.developerTemplateGrant.deleteMany({ where: { tokenId: id } });
      await tx.developerTemplateGrant.createMany({
        data: templateIds.map((templateId) => ({ tokenId: id, templateId })),
      });
    }
    await tx.developerTokenGrant.deleteMany({ where: { tokenId: id } });
    await tx.developerTokenGrant.createMany({
      data: ids.map((deploymentId) => ({ tokenId: id, deploymentId })),
    });
    await tx.auditLog.create({
      data: auditData(req, ownerId, "DEVELOPER_TOKEN_SELECTION_UPDATED", {
        tokenId: id,
        deploymentIds: ids,
        ...(templateIds === undefined ? {} : { templateIds }),
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
export async function listEligibleDeployments(
  ownerId: string,
  query: DeveloperTokenDeploymentQuery,
) {
  const rows = await db.deployment.findMany({
    where: {
      ownerId,
      status: "CONFIRMED",
      serviceState: "ACTIVE",
      ...(query.search
        ? {
            OR: [
              {
                flow: {
                  name: {
                    contains: query.search.replace(/[\\%_]/g, "\\$&"),
                    mode: "insensitive" as const,
                  },
                },
              },
              // UUID columns support exact comparisons; never cast arbitrary search text to UUID.
              ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                query.search,
              )
                ? [{ id: query.search.toLowerCase() }]
                : []),
            ],
          }
        : {}),
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
