import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { saveChallenge } from "@/lib/passkey/challenges";
import { rp } from "@/lib/passkey/rp";

export async function POST() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const existing = await db.passkey.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
    });
    const { rpID, rpName } = rp();
    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: existing.map((c) => ({
        id: Buffer.from(c.credentialId).toString("base64url"),
        transports: c.transports as AuthenticatorTransport[],
      })),
    });
    await saveChallenge("reg", user.id, options.challenge);
    return NextResponse.json({ data: options });
  });
}
