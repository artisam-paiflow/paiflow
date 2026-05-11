import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/errors";
import { saveChallenge } from "@/lib/passkey/challenges";
import { rp } from "@/lib/passkey/rp";
import { z } from "zod";

const Body = z.object({ username: z.string().min(1).max(64).optional() });

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const body = Body.parse(await req.json().catch(() => ({})));
    const { rpID } = rp();

    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] | undefined;
    let userId = "anonymous";
    if (body.username) {
      const user = await db.user.findUnique({
        where: { username: body.username },
        include: { passkeys: true },
      });
      if (user) {
        userId = user.id;
        allowCredentials = user.passkeys.map((p) => ({
          id: Buffer.from(p.credentialId).toString("base64url"),
          transports: (p.transports as AuthenticatorTransport[]) ?? undefined,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials,
    });
    await saveChallenge("auth", userId, options.challenge);
    return NextResponse.json({ data: { ...options, _scope: userId } });
  });
}
