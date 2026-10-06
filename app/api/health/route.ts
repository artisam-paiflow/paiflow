import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { sorobanRpc } from "@/lib/stellar/client";
import { relayerChannelHealth } from "@/lib/stellar/relayer-channels";

export const dynamic = "force-dynamic";

export async function GET() {
  // The short commit the build came from, so a tester can name the candidate.
  // Already public: it is inlined into the client bundle for analytics.
  const out: Record<string, string> = {
    status: "ok",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  };
  try {
    await db.$queryRaw`SELECT 1`;
    out.db = "ok";
  } catch {
    out.db = "down";
    out.status = "degraded";
  }
  const r = redis();
  if (r) {
    try {
      await r.ping();
      out.redis = "ok";
    } catch {
      out.redis = "down";
    }
  } else {
    out.redis = "disabled";
  }
  try {
    await sorobanRpc().getNetwork();
    out.rpc = "ok";
  } catch {
    out.rpc = "down";
    out.status = "degraded";
  }
  // Only a count, never an address or balance: this route is public. The
  // per-channel balances go to the log when the (cached) check refreshes.
  try {
    const channels = await relayerChannelHealth();
    if (channels.configured > 0) {
      out.relayerChannels = `${channels.funded}/${channels.configured}`;
      if (channels.funded === 0) out.status = "degraded";
    }
  } catch {
    out.relayerChannels = "unknown";
  }
  return NextResponse.json(out);
}
