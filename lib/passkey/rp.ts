import "server-only";
import { env } from "@/lib/env";

export function rp() {
  const e = env();
  const origin = e.AUTH_URL;
  return {
    rpID: e.AUTH_RP_ID,
    rpName: e.AUTH_RP_NAME,
    origin,
  };
}
