import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertTemplateCredential, type DeveloperTokenAuth } from "@/lib/api/v1/auth";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/cursor";
import { ListEventsQuerySchema } from "@/lib/api/v1/schema";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { templateBody, templateId } from "@/lib/flow-templates/http";
import {
  InstancePrepareSchema,
  InstanceSubmitSchema,
  InstanceReconcileSchema,
  InstanceListQuerySchema,
} from "./schema";
import {
  prepareTemplateInstance,
  listTemplateInstances,
  getOwnedInstance,
  instanceState,
  submitTemplateInstance,
  reconcileTemplateInstance,
} from "./service";

export type InstanceParams = { id: string; versionId?: string; instanceId?: string };
export type InstanceContext = { params: Promise<InstanceParams> };
export type InstanceAction = "prepare" | "list" | "state" | "submit" | "reconcile" | "events";
export function instanceResponse(data: unknown) {
  return data instanceof Response
    ? data
    : NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
function query(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].length !== new Set(params.keys()).size)
    throw new AppError("VALIDATION", "Duplicate query parameters are unsupported");
  return Object.fromEntries(params);
}
export async function runInstanceAction(
  action: InstanceAction,
  req: NextRequest,
  params: InstanceParams,
  actor: { id: string; role: Role; credential?: DeveloperTokenAuth },
) {
  params = {
    ...params,
    id: templateId(params.id).toLowerCase(),
    ...(params.versionId ? { versionId: templateId(params.versionId).toLowerCase() } : {}),
    ...(params.instanceId ? { instanceId: templateId(params.instanceId).toLowerCase() } : {}),
  };
  if (action === "prepare") templateId(params.versionId ?? "");
  else if (action !== "list") templateId(params.instanceId ?? "");
  const owner = {
    id: actor.id,
    role: actor.role,
    ...(actor.credential
      ? {
          developerApiTokenId: actor.credential.token.id,
          assertCredential: (tx: import("@prisma/client").Prisma.TransactionClient) =>
            assertTemplateCredential(tx, actor.credential!, params.id, true),
        }
      : {}),
  };
  if (action === "prepare") {
    const input = InstancePrepareSchema.parse(await templateBody(req));
    return withInteractiveRpcBudget(() =>
      prepareTemplateInstance(owner, params.id, params.versionId!, input, req),
    );
  }
  if (action === "list")
    return listTemplateInstances(actor.id, params.id, InstanceListQuerySchema.parse(query(req)));
  if (action === "state")
    return instanceState(await getOwnedInstance(actor.id, params.id, params.instanceId!));
  if (action === "submit") {
    InstanceSubmitSchema.parse(await templateBody(req.clone()));
    return submitTemplateInstance(owner, params.id, params.instanceId!, req);
  }
  if (action === "reconcile") {
    InstanceReconcileSchema.parse(await templateBody(req));
    return withInteractiveRpcBudget(() =>
      reconcileTemplateInstance(actor.id, params.id, params.instanceId!),
    );
  }
  const row = await getOwnedInstance(actor.id, params.id, params.instanceId!);
  const input = ListEventsQuerySchema.parse(query(req));
  const after = input.cursor ? decodeCursor(input.cursor) : null;
  if (
    input.cursor &&
    (!after ||
      !/^\d+$/.test(after.head) ||
      !Number.isSafeInteger(Number(after.head)) ||
      Number(after.head) > 2147483647)
  )
    throw new AppError("VALIDATION", "Invalid event cursor");
  const events = await db.contractEvent.findMany({
    where: {
      deploymentId: row.id,
      ...(input.txHash ? { txHash: input.txHash } : {}),
      ...(after
        ? {
            OR: [
              { ledger: { gt: Number(after.head) } },
              { ledger: Number(after.head), eventId: { gt: after.tail } },
            ],
          }
        : {}),
    },
    orderBy: [{ ledger: "asc" }, { eventId: "asc" }],
    take: input.limit + 1,
    select: {
      id: true,
      eventId: true,
      kind: true,
      ledger: true,
      txHash: true,
      occurredAt: true,
      decodedData: true,
      payload: true,
    },
  });
  const page = events.slice(0, input.limit),
    last = page.at(-1);
  return {
    items: page.map(({ decodedData, occurredAt, payload, ...event }) => ({
      ...event,
      topic:
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Array.isArray(payload.topics) &&
        typeof payload.topics[0] === "string"
          ? payload.topics[0]
          : null,
      data: decodedData,
      occurredAt: occurredAt.toISOString(),
    })),
    hasMore: events.length > input.limit,
    nextCursor: last ? encodeCursor(String(last.ledger), last.eventId) : (input.cursor ?? null),
  };
}
