import "server-only";
import { env } from "@/lib/env";

export function rp() {
  const e = env();
  // WebAuthn checks the origin the browser actually used. AUTH_URL is a single
  // value and is also what next-auth pins redirects to, so it cannot describe a
  // service answering on more than one hostname; AUTH_ORIGINS lists them.
  const origin = e.AUTH_ORIGINS.length > 0 ? e.AUTH_ORIGINS : [e.AUTH_URL];
  return {
    rpID: e.AUTH_RP_ID,
    rpName: e.AUTH_RP_NAME,
    origin,
  };
}
