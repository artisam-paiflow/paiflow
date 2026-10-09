import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audienceFor, TRACKING_VERSION } from "./policy";
export async function analyticsContext(userId: string | null) {
  const user = userId
    ? await db.user.findUnique({
        where: { id: userId },
        select: { role: true, analyticsAudience: true },
      })
    : null;
  return {
    account_id: userId ?? "",
    caller_type: userId ? "session" : "wallet",
    audience: audienceFor(user),
    stellar_network: env().STELLAR_NETWORK,
    app_env: env().NEXT_PUBLIC_APP_ENV,
    app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    app_host: new URL(env().NEXT_PUBLIC_APP_URL).host,
    tracking_version: TRACKING_VERSION,
  };
}
