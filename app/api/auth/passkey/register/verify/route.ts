import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { popChallenge } from "@/lib/passkey/challenges";
import { rp } from "@/lib/passkey/rp";
import { audit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const body = await req.json();
    const expectedChallenge = await popChallenge("reg", user.id);
    if (!expectedChallenge) throw new AppError("VALIDATION", "Challenge expired");

    const { rpID, origin } = rp();
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new AppError("VALIDATION", "Registration not verified");
    }
    const info = verification.registrationInfo;
    await db.passkey.create({
      data: {
        userId: user.id,
        credentialId: Buffer.from(info.credential.id, "base64url"),
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter ?? 0),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: (info.credential.transports ?? []) as string[],
        nickname: typeof body.nickname === "string" ? body.nickname.slice(0, 64) : null,
      },
    });
    await audit({ action: "PASSKEY_ADD", userId: user.id });
    return NextResponse.json({ data: { ok: true } });
  });
}
