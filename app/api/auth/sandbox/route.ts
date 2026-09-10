import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Role, TemplateKind } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { saveChallenge } from "@/lib/passkey/challenges";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { SANDBOX_STARTER_GRAPH } from "@/lib/flows/starter";
import { SANDBOX_PASSWORD_SENTINEL } from "@/lib/sandbox";

/**
 * Creates a throwaway sandbox session so someone with no account can try the
 * builder on testnet (Instawards D1 asks for a public URL where the Swap block
 * is usable without an account).
 *
 * The user is real but disposable: a `SANDBOX`-role row whose stored password
 * is a sentinel that can never verify, so the only way in is the single-use
 * ticket returned here.
 * `middleware.ts` limits the role to the builder and deploy surfaces. Deploys
 * still come from the visitor's own wallet — nothing custodial changes.
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    if (!env().SANDBOX_ENABLED) {
      throw new AppError("FORBIDDEN", "The sandbox is not enabled on this instance");
    }
    // Two caps, because this endpoint creates a row with no credential of any
    // kind behind it. The per-IP one is the useful signal; the instance-wide one
    // is the backstop, since clientIp() trusts the first X-Forwarded-For entry
    // and an attacker sets that header freely.
    const ip = clientIp(req);
    const perIp = await rateLimit(`sandbox:${ip}`, 5, 60 * 10);
    if (!perIp.ok) {
      throw new AppError("RATE_LIMITED", "Too many sandbox sessions from this address");
    }
    const global = await rateLimit("sandbox:global", 120, 60 * 60);
    // `shared` is false when rateLimit() fell back to its per-process bucket
    // (no REDIS_URL, or Redis is down). The instance-wide cap is the only thing
    // bounding how many rows an anonymous caller can create — a per-process
    // count does not bound it across replicas — so this one fails closed rather
    // than degrading silently. Redis comes up with `pnpm docker:up` locally.
    if (!global.shared) {
      log.warn({ ip }, "sandbox mint refused: no shared rate limiter available");
      throw new AppError("RATE_LIMITED", "The sandbox is unavailable right now. Try again later.");
    }
    if (!global.ok) {
      throw new AppError("RATE_LIMITED", "The sandbox is busy right now. Try again shortly.");
    }

    // See lib/sandbox.ts: a sentinel, not a hash, so no password can open this
    // account and an unauthenticated caller cannot drive argon2.
    const passwordHash = SANDBOX_PASSWORD_SENTINEL;
    const username = `sandbox-${crypto.randomBytes(4).toString("hex")}`;

    const v = validateFlow(SANDBOX_STARTER_GRAPH);
    if (!v.ok) {
      // The graph is a checked-in constant covered by a unit test; a failure
      // here means the constant drifted from the validator, not bad input.
      throw new AppError("INTERNAL", "Sandbox starter flow is invalid");
    }

    const user = await db.user.create({
      data: {
        username,
        passwordHash,
        role: Role.SANDBOX,
        flows: {
          create: {
            name: "Swap XLM to USDC",
            templateKind: v.templateKind satisfies TemplateKind,
            graph: v.graph as object,
            parameters: flowToPipeline(v.graph) as object,
          },
        },
      },
      select: { id: true, username: true },
    });

    // Single-use ticket (5 min TTL, see lib/passkey/challenges.ts) exchanged by
    // the client through the Credentials provider's `passkeyTicket` branch in
    // lib/auth.ts — the same handshake the passkey login uses.
    const ticket = `${user.id}.${Date.now()}.${crypto.randomBytes(16).toString("hex")}`;
    try {
      await saveChallenge("ticket", ticket, user.id);
    } catch (err) {
      // The user row and its flow are already committed, and the ticket is the
      // only way into the account. Without this the failure leaves an active
      // SANDBOX user nobody can reach and nothing deletes. The flow cascades.
      await db.user.delete({ where: { id: user.id } }).catch((cleanupErr: unknown) => {
        log.error({ err: cleanupErr, userId: user.id }, "failed to roll back sandbox user");
      });
      throw err;
    }

    await audit({
      action: "SANDBOX_CREATE",
      userId: user.id,
      ip,
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ data: { ticket, username: user.username } }, { status: 201 });
  });
}
