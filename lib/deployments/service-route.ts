import "server-only";
import type { NextRequest } from "next/server";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { requireDevAuth, requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { withDeploymentWork } from "./service-work";

/** Existing handlers retain authentication, ownership, schemas and rate limits.
 * Admission spans the whole mutation, including bookkeeping after submission. */
export function deploymentServiceRoute<P extends { id: string }>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  auth: "owner" | "dev" | "public" = "public",
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> =>
    withErrorHandler(async () => {
      const { id } = await ctx.params;
      // Authenticate and scope owner/dev callers before making any admission.
      // Public wallet-signed surfaces retain their existing authorization.
      if (auth !== "public") {
        const user = auth === "dev" ? (await requireDevAuth(req)).user : await requireSession();
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
      return withDeploymentWork(id, new URL(req.url).pathname, () => handler(req, ctx));
    });
}
