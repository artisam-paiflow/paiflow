import "server-only";
import { Prisma, Role } from "@prisma/client";
import type { NextRequest } from "next/server";
import type { AuditAction } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { serverFeatures } from "@/lib/features";
import { validateFlow } from "@/lib/flows/validate";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { bindTemplateVersion, validateTemplateDefinition } from "./binder";
import { assertPinnedTemplateArtifacts, contentHash, pinTemplateArtifacts } from "./artifacts";
import type {
  CreateFlowTemplate,
  UpdateFlowTemplate,
  PublishFlowTemplate,
  FlowTemplateListQuery,
} from "./schema";

export async function requireTemplateManager(write = false) {
  const user = await requireSession();
  if (user.role === Role.SANDBOX)
    throw new AppError("FORBIDDEN", "Private templates are unavailable in sandbox sessions");
  if (write)
    await enforceRateLimit({
      key: `flow-templates:write:${user.id}`,
      limit: 30,
      windowSeconds: 60,
    });
  return user;
}
function notFound(): never {
  throw new AppError("NOT_FOUND", "Template or version not found");
}
const summarySelect = {
  id: true,
  name: true,
  description: true,
  draftRevision: true,
  retiredAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
function auditData(
  ownerId: string,
  action: AuditAction,
  metadata: Prisma.InputJsonValue,
  req: NextRequest,
) {
  return {
    userId: ownerId,
    action,
    metadata,
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  };
}
async function lockTemplate(tx: Prisma.TransactionClient, ownerId: string, templateId: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "FlowTemplate" WHERE id = ${templateId}::uuid AND "ownerId" = ${ownerId}::uuid FOR UPDATE`;
  if (!rows.length) notFound();
  return tx.flowTemplate.findUniqueOrThrow({ where: { id: templateId } });
}
function active(template: { retiredAt: Date | null }) {
  if (template.retiredAt) throw new AppError("CONFLICT", "Template is retired");
}
function revision(template: { draftRevision: number }, expected: number) {
  if (template.draftRevision !== expected)
    throw new AppError("CONFLICT", "Draft changed; reload before editing or publishing");
}
export async function createFlowTemplate(
  ownerId: string,
  input: CreateFlowTemplate,
  req: NextRequest,
) {
  const definition = validateTemplateDefinition(input.definition);
  return db.$transaction(async (tx) => {
    const row = await tx.flowTemplate.create({
      data: { ownerId, name: input.name, description: input.description, draft: definition },
    });
    await tx.auditLog.create({
      data: auditData(ownerId, "FLOW_TEMPLATE_CREATE", { templateId: row.id }, req),
    });
    return row;
  });
}
export async function getFlowTemplate(ownerId: string, templateId: string) {
  const row = await db.flowTemplate.findFirst({ where: { id: templateId, ownerId } });
  if (!row) notFound();
  return row;
}
export async function listFlowTemplates(ownerId: string, query: FlowTemplateListQuery) {
  const cursor = query.cursor
    ? await db.flowTemplate.findFirst({
        where: { id: query.cursor, ownerId },
        select: { id: true, createdAt: true },
      })
    : null;
  if (query.cursor && !cursor) notFound();
  const items = await db.flowTemplate.findMany({
    where: {
      ownerId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: summarySelect,
  });
  const nextCursor = items.length > query.limit ? items[query.limit - 1]!.id : null;
  return { items: items.slice(0, query.limit), nextCursor };
}
export async function updateFlowTemplate(
  ownerId: string,
  templateId: string,
  input: UpdateFlowTemplate,
  req: NextRequest,
) {
  const definition = input.definition ? validateTemplateDefinition(input.definition) : undefined;
  return db.$transaction(async (tx) => {
    const template = await lockTemplate(tx, ownerId, templateId);
    active(template);
    revision(template, input.expectedRevision);
    const updated = await tx.flowTemplate.update({
      where: { id: templateId },
      data: {
        name: input.name,
        description: input.description,
        draft: definition,
        draftRevision: { increment: 1 },
      },
    });
    await tx.auditLog.create({
      data: auditData(
        ownerId,
        "FLOW_TEMPLATE_UPDATE",
        { templateId, draftRevision: updated.draftRevision },
        req,
      ),
    });
    return updated;
  });
}
export async function publishFlowTemplate(
  ownerId: string,
  templateId: string,
  input: PublishFlowTemplate,
  req: NextRequest,
) {
  return db.$transaction(async (tx) => {
    const template = await lockTemplate(tx, ownerId, templateId);
    active(template);
    revision(template, input.expectedRevision);
    const definition = validateTemplateDefinition(template.draft, true);
    const validation = validateFlow(definition.graph, {
      ignoreOwnerEmail: true,
      features: serverFeatures(),
    });
    if (!validation.ok)
      throw new AppError("VALIDATION", "Template uses invalid or unavailable blocks");
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now())
      throw new AppError("VALIDATION", "Version expiry must be in the future");
    const network = env().STELLAR_NETWORK;
    const artifacts = await pinTemplateArtifacts(definition.graph, network, tx);
    const row = await tx.flowTemplateVersion.create({
      data: {
        templateId,
        version: template.nextVersion,
        definition,
        network,
        artifacts,
        contentHash: contentHash({
          definition,
          network,
          artifacts,
          expiresAt: expiresAt?.toISOString() ?? null,
        }),
        expiresAt,
      },
    });
    await tx.flowTemplate.update({
      where: { id: templateId },
      data: { nextVersion: { increment: 1 } },
    });
    await tx.auditLog.create({
      data: auditData(
        ownerId,
        "FLOW_TEMPLATE_PUBLISH",
        {
          templateId,
          templateVersionId: row.id,
          version: row.version,
          contentHash: row.contentHash,
        },
        req,
      ),
    });
    return row;
  });
}
export async function getFlowTemplateVersion(
  ownerId: string,
  templateId: string,
  versionId: string,
) {
  const row = await db.flowTemplateVersion.findFirst({
    where: { id: versionId, templateId, template: { ownerId } },
  });
  if (!row) notFound();
  return row;
}
export async function listFlowTemplateVersions(
  ownerId: string,
  templateId: string,
  query: FlowTemplateListQuery,
) {
  await getFlowTemplate(ownerId, templateId);
  const cursor = query.cursor
    ? await db.flowTemplateVersion.findFirst({
        where: { id: query.cursor, templateId, template: { ownerId } },
        select: { id: true, createdAt: true },
      })
    : null;
  if (query.cursor && !cursor) notFound();
  const items = await db.flowTemplateVersion.findMany({
    where: {
      templateId,
      template: { ownerId },
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true,
      templateId: true,
      version: true,
      network: true,
      contentHash: true,
      createdAt: true,
      retiredAt: true,
      expiresAt: true,
    },
  });
  const nextCursor = items.length > query.limit ? items[query.limit - 1]!.id : null;
  return { items: items.slice(0, query.limit), nextCursor };
}
export async function retireFlowTemplate(
  ownerId: string,
  templateId: string,
  req: NextRequest,
  versionId?: string,
) {
  return db.$transaction(async (tx) => {
    await lockTemplate(tx, ownerId, templateId);
    if (versionId) {
      const version = await tx.flowTemplateVersion.findFirst({
        where: { id: versionId, templateId },
      });
      if (!version) notFound();
      if (version.retiredAt) return version;
      const updated = await tx.flowTemplateVersion.update({
        where: { id: versionId },
        data: { retiredAt: new Date() },
      });
      await tx.auditLog.create({
        data: auditData(
          ownerId,
          "FLOW_TEMPLATE_VERSION_RETIRE",
          { templateId, templateVersionId: versionId },
          req,
        ),
      });
      return updated;
    }
    const template = await tx.flowTemplate.findUniqueOrThrow({ where: { id: templateId } });
    if (template.retiredAt) return template;
    const updated = await tx.flowTemplate.update({
      where: { id: templateId },
      data: { retiredAt: new Date() },
    });
    await tx.auditLog.create({
      data: auditData(ownerId, "FLOW_TEMPLATE_RETIRE", { templateId }, req),
    });
    return updated;
  });
}
/** Lock order: template first, then the caller's instance/deployment admission.
 * All draft/publication/retirement writes acquire the same template FOR UPDATE.
 * #1165 must persist its pinned preparation/admission in this SAME transaction,
 * then release before simulation/RPC. Do not treat a previous validation response
 * as admission. Already-admitted unknown finality must never clear by timeout. */
export async function lockAndResolveTemplateForPreparation(
  tx: Prisma.TransactionClient,
  ownerId: string,
  templateId: string,
  versionId: string,
  bindings: unknown,
) {
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "FlowTemplate" WHERE id = ${templateId}::uuid AND "ownerId" = ${ownerId}::uuid FOR SHARE`;
  if (!locked.length) notFound();
  const template = await tx.flowTemplate.findUniqueOrThrow({ where: { id: templateId } });
  active(template);
  const version = await tx.flowTemplateVersion.findFirst({ where: { id: versionId, templateId } });
  if (!version) notFound();
  if (version.retiredAt || (version.expiresAt && version.expiresAt.getTime() <= Date.now()))
    throw new AppError("CONFLICT", "Template version is retired or expired");
  if (version.network !== env().STELLAR_NETWORK)
    throw new AppError("CONFLICT", "Template version belongs to another environment network");
  const resolved = bindTemplateVersion(version.definition, version.id, bindings);
  const validation = validateFlow(resolved.graph, {
    ignoreOwnerEmail: true,
    features: serverFeatures(),
  });
  if (!validation.ok) throw new AppError("VALIDATION", "Bound flow uses unavailable blocks");
  const artifacts = await assertPinnedTemplateArtifacts(
    resolved.graph,
    version.network,
    version.artifacts,
    tx,
  );
  return { version, ...resolved, artifacts };
}
/** Read-only binding preview. Instantiation MUST repeat locked admission above. */
export async function resolveTemplateForPreparation(
  ownerId: string,
  templateId: string,
  versionId: string,
  bindings: unknown,
) {
  return db.$transaction((tx) =>
    lockAndResolveTemplateForPreparation(tx, ownerId, templateId, versionId, bindings),
  );
}
