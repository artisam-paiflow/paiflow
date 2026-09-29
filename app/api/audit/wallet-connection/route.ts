import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { withErrorHandler } from "@/lib/errors";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { enforceRateLimit, clientIp, rateLimitSubject, CALLER_RATE_LIMITS } from "@/lib/rate-limit";

const Body = z.object({
  address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  network: z.enum(["testnet", "mainnet"]),
  walletId: z.string().trim().min(1).max(64),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const body = Body.parse(await req.json());
    const ip = clientIp(req);
    const { perCaller, ipBackstop } = CALLER_RATE_LIMITS.walletConnect;
    // A loose address-wide bucket first, then one per signed-in user (per
    // address for a guest), so a venue's shared Wi-Fi is not one bucket (#725).
    await enforceRateLimit({ key: `wallet-connect:backstop:${ip}`, ...ipBackstop });
    const user = await getSessionUser();
    await enforceRateLimit({ key: `wallet-connect:${rateLimitSubject(user, ip)}`, ...perCaller });
    await audit({
      action: "WALLET_CONNECT",
      userId: user?.id ?? null,
      ip,
      userAgent: req.headers.get("user-agent"),
      metadata: { address: body.address, network: body.network, walletId: body.walletId },
    });
    return NextResponse.json({ data: { ok: true } });
  });
}
