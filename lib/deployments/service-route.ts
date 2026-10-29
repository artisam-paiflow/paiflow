import "server-only";
import type { NextRequest } from "next/server";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { hasRetiredPayrollInput, PAYROLL_RETIRED_MESSAGE } from "@/lib/flows/retired-payroll";
import { withDeploymentWork } from "./service-work";

/** Existing handlers retain authentication, ownership, schemas and rate limits.
 * Admission spans the whole mutation, including bookkeeping after submission. */
export function deploymentServiceRoute<P extends { id: string }>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  auth: "owner" | "public" = "public",
  options: { allowRetiredHistory?: boolean } = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> =>
    withErrorHandler(async () => {
      const { id } = await ctx.params;
      // Authenticate and scope owner callers before making any admission.
      // Public wallet-signed surfaces retain their existing authorization.
      if (auth !== "public") {
        const user = await requireSession();
        const owned = await db.deployment.findFirst({
          where: { id, ownerId: user.id },
          select: { id: true },
        });
        if (!owned) throw new AppError("NOT_FOUND", "Deployment not found");
      }
      await enforceRateLimit({
        key: `service-admission:${clientIp(req)}`,
        limit: 600,
        windowSeconds: 60,
      });
      const recorded = await db.deployment.findUnique({
        where: { id },
        select: {
          graphSnapshot: true,
          paramsSnapshot: true,
          pipelineSnapshot: true,
          flow: { select: { templateKind: true } },
        },
      });
      if (hasRetiredPayrollInput(recorded)) {
        if (options.allowRetiredHistory && req.method === "GET") return handler(req, ctx);
        throw new AppError("NOT_FOUND", PAYROLL_RETIRED_MESSAGE);
      }
      return withDeploymentWork(id, new URL(req.url).pathname, async () => {
        return handler(req, ctx);
      });
    });
}
