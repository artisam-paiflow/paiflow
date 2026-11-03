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

type Context = { params: Promise<{ id: string }> };
export function hostedPublicRoute(
  action: "state" | "ownership" | "prepare" | "submit" | "receipt",
) {
  return (req: NextRequest, ctx: Context) =>
    withErrorHandler(() =>
      withInteractiveRpcBudget(async () => {
        const { id } = await ctx.params;
        if (!z.uuid().safeParse(id).success)
          throw new AppError("NOT_FOUND", "Payment form is unavailable");
        const ip = clientIp(req);
        await enforceRateLimit({ key: `hosted-execution:ip:${ip}`, limit: 120, windowSeconds: 60 });
        await enforceRateLimit({
          key: `hosted-execution:${id}:${action}:${ip}`,
          limit: action === "prepare" || action === "ownership" ? 12 : 60,
          windowSeconds: 60,
        });
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
          return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
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
      }),
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
    const input = HostedVisibilitySchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const deployment = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!deployment) throw new AppError("NOT_FOUND", "Deployment not found");
    return NextResponse.json({
      data: await setHostedVisibility(deployment, user.id, input.enabled, ip),
    });
  },
  "owner",
);
