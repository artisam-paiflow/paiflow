import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { withDeploymentWork } from "@/lib/deployments/service-work";
import { readExecutionState } from "@/lib/stellar/execution-state";
import { createHostedOwnershipChallenge } from "@/lib/stellar/hosted-ownership";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import {
  HostedPrepareSchema,
  HostedReceiptRequestSchema,
  HostedSubmitSchema,
  HostedVisibilitySchema,
  HostedOwnershipRequestSchema,
} from "./schema";
import {
  hostedDeployment,
  prepareHostedPayment,
  readHostedReceipt,
  reconcileHostedPayment,
  setHostedVisibility,
  submitHostedPayment,
} from "./service";

import { conditionalExecutionVersion } from "@/lib/api/v1/conditional-execution-schema";
import { createConditionalHostedOwnershipChallenge } from "@/lib/stellar/conditional-hosted-ownership";
import {
  ConditionalHostedOwnershipRequestSchema,
  ConditionalHostedPrepareSchema,
} from "./conditional-schema";
import {
  conditionalHostedDeployment,
  readConditionalHostedState,
  prepareConditionalHostedPayment,
  submitConditionalHostedPayment,
  reconcileConditionalHostedPayment,
  setConditionalHostedVisibility,
  conditionalHostedPublicError,
} from "./conditional-service";

type Context = { params: Promise<{ id: string }> };
export function hostedPublicRoute(
  action: "state" | "ownership" | "prepare" | "submit" | "receipt",
) {
  return async (req: NextRequest, ctx: Context) => {
    let conditional = false;
    const response = await withErrorHandler(async () => {
      const version = conditionalExecutionVersion(new URL(req.url).searchParams);
      conditional = version === 2;
      try {
        return await withInteractiveRpcBudget(async () => {
          const { id } = await ctx.params;
          if (!z.uuid().safeParse(id).success)
            throw new AppError("NOT_FOUND", "Payment form is unavailable");
          const ip = clientIp(req);
          await enforceRateLimit({
            key: `hosted-execution:ip:${ip}`,
            limit: 120,
            windowSeconds: 60,
          });
          await enforceRateLimit({
            key: `hosted-execution:${id}:${action}:${ip}`,
            limit: action === "prepare" || action === "ownership" ? 12 : 60,
            windowSeconds: 60,
          });
          if (version === 2) return conditionalHostedAction(action, req, id, ip);
          const deployment = await hostedDeployment(
            id,
            action === "state" || action === "ownership" || action === "prepare",
          );
          if (action === "state") {
            const state = await withDeploymentWork(id, "hosted-execution:state", () =>
              readExecutionState(deployment),
            );
            if (!state.supported) throw new AppError("NOT_FOUND", "Payment form is unavailable");
            return NextResponse.json({ data: state }, { headers: { "Cache-Control": "no-store" } });
          }
          const body: unknown = await req.json().catch(() => {
            throw new AppError("VALIDATION", "Request body must be valid JSON");
          });
          if (action === "ownership") {
            const input = HostedOwnershipRequestSchema.parse(body);
            return NextResponse.json(
              { data: createHostedOwnershipChallenge(id, input) },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          if (action === "prepare") {
            const input = HostedPrepareSchema.parse(body);
            const result = await withDeploymentWork(id, "hosted-execution:prepare", () =>
              prepareHostedPayment(deployment, input),
            );
            return NextResponse.json(
              { data: result },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          if (action === "submit") {
            const input = HostedSubmitSchema.parse(body);
            await readHostedReceipt(id, input.recoveryKey);
            return NextResponse.json({ data: await submitHostedPayment(deployment, input, ip) });
          }
          const input = HostedReceiptRequestSchema.parse(body);
          return NextResponse.json(
            { data: await reconcileHostedPayment(deployment, input.recoveryKey) },
            { headers: { "Cache-Control": "no-store" } },
          );
        });
      } catch (error) {
        throw version === 2 ? conditionalHostedPublicError(error) : error;
      }
    });
    if (conditional) response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

async function conditionalHostedAction(
  action: "state" | "ownership" | "prepare" | "submit" | "receipt",
  req: NextRequest,
  id: string,
  ip: string,
) {
  const deployment = await conditionalHostedDeployment(
    id,
    action === "state" || action === "ownership" || action === "prepare",
  );
  const headers = { "Cache-Control": "no-store" };
  if (action === "state")
    return NextResponse.json(
      {
        data: await withDeploymentWork(deployment.id, "hosted-execution:state", () =>
          readConditionalHostedState(deployment),
        ),
      },
      { headers },
    );
  const body: unknown = await req.json().catch(() => {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  });
  if (action === "ownership") {
    const input = ConditionalHostedOwnershipRequestSchema.parse(body);
    await withDeploymentWork(deployment.id, "hosted-execution:ownership", () =>
      readConditionalHostedState(deployment),
    );
    return NextResponse.json(
      { data: createConditionalHostedOwnershipChallenge(deployment.id, input) },
      { headers },
    );
  }
  if (action === "prepare") {
    const input = ConditionalHostedPrepareSchema.parse(body);
    return NextResponse.json(
      {
        data: await withDeploymentWork(deployment.id, "hosted-execution:prepare", () =>
          prepareConditionalHostedPayment(deployment, input),
        ),
      },
      { headers },
    );
  }
  if (action === "submit")
    return NextResponse.json(
      {
        data: await submitConditionalHostedPayment(deployment, HostedSubmitSchema.parse(body), ip),
      },
      { headers },
    );
  return NextResponse.json(
    {
      data: await reconcileConditionalHostedPayment(
        deployment,
        HostedReceiptRequestSchema.parse(body).recoveryKey,
      ),
    },
    { headers },
  );
}

export const updateHostedVisibility = deploymentServiceRoute(
  async (req: NextRequest, ctx: Context) => {
    const user = await requireSession();
    if (user.role === "SANDBOX")
      throw new AppError("FORBIDDEN", "Hosted payment publishing is unavailable in the sandbox");
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `hosted-visibility:${user.id}`, limit: 20, windowSeconds: 60 });
    const version = conditionalExecutionVersion(new URL(req.url).searchParams);
    const input = HostedVisibilitySchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const deployment = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    try {
      return NextResponse.json({
        data: await (version === 2 ? setConditionalHostedVisibility : setHostedVisibility)(
          deployment,
          user.id,
          input.enabled,
          ip,
        ),
      });
    } catch (error) {
      throw version === 2 ? conditionalHostedPublicError(error) : error;
    }
  },
  "owner",
);
