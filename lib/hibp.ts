import "server-only";
import { createHash } from "node:crypto";
import { env } from "./env";
import { log } from "./log";

/**
 * Checks a password against Have I Been Pwned's k-anonymity API. Returns:
 *  - count >= 1 if the password is present in known breaches
 *  - 0 if it isn't
 *  - null if the check was skipped or upstream failed (fail-open)
 */
export async function pwnedCount(password: string): Promise<number | null> {
  if (!env().HIBP_CHECK_ENABLED) return null;
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split(/\r?\n/)) {
      const [hash, countStr] = line.split(":");
      if (hash === suffix) return Number(countStr) || 0;
    }
    return 0;
  } catch (err) {
    log.warn({ err }, "HIBP check failed");
    return null;
  }
}
