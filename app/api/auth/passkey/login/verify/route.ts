import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { popChallenge } from "@/lib/passkey/challenges";
import { rp } from "@/lib/passkey/rp";
import { audit } from "@/lib/audit";

/**
 * Verifies a WebAuthn assertion. On success returns a single-use "ticket"
 * (random nonce) that the client immediately exchanges via NextAuth's
 * Credentials provider in a separate "passkey-ticket" path. For the v0.2
 * scope here we return the userId and let the UI POST to next-auth's
 * signin/credentials endpoint with a special PASSKEY_TICKET marker.
 *
 * For simplicity and because Auth.js v5 ties session creation to the
 * Credentials authorize() callback, this route just verifies and returns
 * the verified userId — the caller persists a short-lived ticket in Redis
 * and signs in via Credentials provider using that ticket.
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const body = await req.json();
    const scope = String(body._scope ?? "anonymous");
    const expectedChallenge = await popChallenge("auth", scope);
    if (!expectedChallenge) throw new AppError("VALIDATION", "Challenge expired");
    const { rpID, origin } = rp();

    const credentialIdRaw = body.id ?? body.rawId;
    if (typeof credentialIdRaw !== "string") {
      throw new AppError("VALIDATION", "Missing credential id");
    }
    const credentialIdBuf = Buffer.from(credentialIdRaw, "base64url");
    const passkey = await db.passkey.findUnique({
      where: { credentialId: credentialIdBuf },
      include: { user: true },
    });
    if (!passkey || !passkey.user.isActive) {
      throw new AppError("UNAUTHENTICATED", "Unknown passkey");
    }

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: Buffer.from(passkey.credentialId).toString("base64url"),
        publicKey: Buffer.from(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: (passkey.transports as AuthenticatorTransport[]) ?? undefined,
      },
    });
    if (!verification.verified) {
      throw new AppError("UNAUTHENTICATED", "Authentication not verified");
    }
    await db.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await audit({ action: "USER_LOGIN", userId: passkey.userId, metadata: { via: "passkey" } });

    // Stash a short-lived ticket the caller can present to the Credentials
    // provider; one-shot, 60s.
    const ticket = `${passkey.userId}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    const { saveChallenge } = await import("@/lib/passkey/challenges");
    await saveChallenge("ticket", ticket, passkey.userId);
    return NextResponse.json({ data: { ticket } });
  });
}
