import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { sorobanRpc } from "@/lib/stellar/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const out: Record<string, string> = { status: "ok" };
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
  return NextResponse.json(out);
}
