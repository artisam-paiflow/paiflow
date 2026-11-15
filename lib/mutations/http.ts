import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { Deployment, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { executionIdempotencyKey } from "@/lib/api/v1/execution-intent";
import type { DeploymentTokenAuth } from "@/lib/api/v1/auth";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { readMutationState } from "@/lib/stellar/mutation-state";
import {
  ConfigurationHistoryQuerySchema,
  MutationPrepareSchema,
  MutationSubmitSchema,
  MutationReconcileSchema,
} from "./schema";
import { configurationHistory } from "./history";
import { prepareMutation, submitMutation, reconcileMutation } from "./service";
import { conditionalExecutionVersion } from "@/lib/api/v1/conditional-execution-schema";
import { hasConditionalDeploymentDeclaration } from "@/lib/flows/conditional-deployment";
import { ConditionalMutationPrepareSchema } from "./conditional-schema";
import {
  prepareConditionalMutation,
  submitConditionalMutation,
  reconcileConditionalMutation,
} from "./conditional-service";
import { readConditionalMutationState } from "@/lib/stellar/conditional-mutation-state";
import { conditionalConfigurationHistory } from "./conditional-history";

type Action = "state" | "history" | "prepare" | "submit" | "reconcile";
async function json(req: Request) {
  return req.json().catch(() => {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  });
}
export async function mutationAdmission(
  tx: Prisma.TransactionClient,
  deployment: Deployment,
  credential?: DeploymentTokenAuth,
) {
  const owner = await tx.user.findUnique({
    where: { id: deployment.ownerId },
    select: { isActive: true, role: true },
  });
  const owned = await tx.deployment.findFirst({
    where: {
      id: deployment.id,
      ownerId: deployment.ownerId,
      network: env().STELLAR_NETWORK,
      status: "CONFIRMED",
      serviceState: "ACTIVE",
    },
    select: { id: true },
  });
  if (!owner?.isActive || owner.role === "SANDBOX" || !owned)
    throw new AppError("FORBIDDEN", "Deployment owner access is unavailable");
  if (!credential) return;
  const where = {
    id: credential.token.id,
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
  if (credential.tokenType === "developer_token") {
    const token = await tx.developerApiToken.findFirst({
      where: {
        ...where,
        ownerId: deployment.ownerId,
        permission: "READ_OPERATE",
        grants: { some: { deploymentId: deployment.id } },
      },
      select: { id: true },
    });
    if (!token)
      throw new AppError("UNAUTHENTICATED", "A valid API token for this deployment is required");
  } else {
    const token = await tx.deploymentApiToken.findFirst({
      where: { ...where, deploymentId: deployment.id },
      select: { id: true },
    });
    if (!token)
      throw new AppError("UNAUTHENTICATED", "A valid API token for this deployment is required");
  }
}
export async function runMutationAction(
  action: Action,
  req: NextRequest,
  deployment: Deployment,
  credential?: DeploymentTokenAuth,
  ownerSessionId?: string,
) {
  const assertAdmission = (tx: Prisma.TransactionClient) =>
    mutationAdmission(tx, deployment, credential);
  const data = await withInteractiveRpcBudget(async () => {
    const version = conditionalExecutionVersion(new URL(req.url).searchParams);
    if (version === 1 && hasConditionalDeploymentDeclaration(deployment.paramsSnapshot))
      throw new AppError(
        "VALIDATION",
        "Conditional configuration requires explicit version2 opt-in",
      );
    if (action === "state")
      return version === 2
        ? readConditionalMutationState(deployment)
        : readMutationState(deployment);
    if (action === "history") {
      const query = new URL(req.url).searchParams;
      if ([...query.keys()].length !== new Set(query.keys()).size)
        throw new AppError("VALIDATION", "Duplicate query parameters are unsupported");
      query.delete("version");
      return (version === 2 ? conditionalConfigurationHistory : configurationHistory)(
        deployment.id,
        ConfigurationHistoryQuerySchema.parse(Object.fromEntries(query)),
      );
    }
    if (action === "prepare") {
      const raw = await json(req);
      const keyHash = executionIdempotencyKey(req.headers.get("idempotency-key"));
      if (!keyHash)
        throw new AppError("VALIDATION", "Idempotency-Key is required for configuration changes");
      const prepared =
        version === 2
          ? await prepareConditionalMutation(
              deployment,
              ConditionalMutationPrepareSchema.parse(raw),
              keyHash,
              assertAdmission,
              clientIp(req),
            )
          : await prepareMutation(
              deployment,
              MutationPrepareSchema.parse(raw),
              keyHash,
              assertAdmission,
              clientIp(req),
            );
      linkApiTransaction(prepared.txHash);
      return prepared;
    }
    if (action === "submit") {
      const body = MutationSubmitSchema.parse(await json(req));
      return (version === 2 ? submitConditionalMutation : submitMutation)({
        deployment,
        ...body,
        ip: clientIp(req),
        assertAdmission,
        ...(credential ? { tokenId: credential.token.id, tokenType: credential.tokenType } : {}),
        ownerSessionId,
      });
    }
    const body = MutationReconcileSchema.parse(await json(req));
    const reconciled = await (version === 2 ? reconcileConditionalMutation : reconcileMutation)(
      deployment,
      body.intent,
    );
    linkApiTransaction(reconciled.transaction.txHash);
    return reconciled;
  });
  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
export function ownerMutationRoute(action: Action) {
  return deploymentServiceRoute(async (req, ctx) => {
    const user = await requireSession();
    if (user.role === "SANDBOX") throw new AppError("FORBIDDEN", "Not available in the sandbox");
    const { id } = await ctx.params;
    if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND", "Deployment not found");
    await enforceRateLimit({
      key: `configuration:${action}:${user.id}`,
      limit: action === "prepare" ? 10 : 30,
      windowSeconds: 60,
    });
    const deployment = await db.deployment.findFirst({
      where: {
        id,
        ownerId: user.id,
        network: env().STELLAR_NETWORK,
        status: "CONFIRMED",
        serviceState: "ACTIVE",
      },
    });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    return runMutationAction(action, req, deployment, undefined, user.id);
  }, "owner");
}
