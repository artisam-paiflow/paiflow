import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export interface PdaxTokens {
  accessToken: string;
  idToken?: string;
  username?: string;
}

function baseUrl(): string {
  const url = env().OFFRAMP_API_URL ?? "https://api.pdax.ph";
  return url.replace(/\/$/, "");
}

async function getCredential(provider: string): Promise<{
  accessToken?: string;
  idToken?: string | null;
  username?: string;
  apiUrl?: string | null;
  expiresAt?: Date | null;
} | null> {
  const row = await db.offRampProviderCredential.findUnique({
    where: { provider },
  });
  if (row) {
    return {
      accessToken: row.accessToken || undefined,
      idToken: row.idToken ?? undefined,
      username: row.username,
      apiUrl: row.apiUrl,
      expiresAt: row.expiresAt,
    };
  }

  // Fallback to env vars. The refresh token lives ONLY in OFFRAMP_REFRESH_TOKEN.
  const username = env().OFFRAMP_USERNAME;
  const accessToken = env().OFFRAMP_ACCESS_TOKEN;
  if (!username || !env().OFFRAMP_REFRESH_TOKEN) return null;
  return {
    accessToken: accessToken || undefined,
    idToken: env().OFFRAMP_ID_TOKEN ?? undefined,
    username,
  };
}

/**
 * Return true if the stored token looks expired or incomplete. PDAX access/id
 * tokens are short-lived (~10 minutes). We refresh proactively rather than
 * waiting for a 401, because the cron and payout paths should not fail on a
 * race with token expiry.
 */
function shouldRefresh(tokens: {
  accessToken?: string;
  idToken?: string | null;
  expiresAt?: Date | null;
}): boolean {
  if (!tokens.accessToken || !tokens.idToken) return true;
  if (!tokens.expiresAt) return true;
  // Refresh if expires within 2 minutes.
  return tokens.expiresAt.getTime() - Date.now() < 2 * 60 * 1000;
}

/**
 * Ensure we have a valid PDAX access token, refreshing from OFFRAMP_REFRESH_TOKEN
 * if necessary. Throws if no usable token can be obtained.
 */
async function ensurePdaxTokens(): Promise<{
  accessToken: string;
  idToken?: string;
  username?: string;
}> {
  const tokens = await getCredential("pdax");
  if (!tokens) {
    throw new Error(
      "PDAX credentials are not configured. Set OFFRAMP_USERNAME and OFFRAMP_REFRESH_TOKEN (and optionally OFFRAMP_ACCESS_TOKEN / OFFRAMP_ID_TOKEN).",
    );
  }

  if (!shouldRefresh(tokens)) {
    return {
      accessToken: tokens.accessToken!,
      idToken: tokens.idToken ?? undefined,
      username: tokens.username,
    };
  }

  const refreshed = await refreshPdaxAccessToken();
  if (!refreshed) {
    throw new Error("PDAX access token is missing/expired and refresh failed");
  }

  return {
    accessToken: refreshed.accessToken,
    idToken: refreshed.idToken,
    username: tokens.username,
  };
}

/**
 * Build the header object used by every PDAX Institution request.
 */
export async function getPdaxAuthHeaders(): Promise<Record<string, string>> {
  const tokens = await ensurePdaxTokens();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokens.accessToken}`,
    access_token: tokens.accessToken,
  };

  if (tokens.idToken) {
    headers["id_token"] = tokens.idToken;
  }

  return headers;
}

async function persistTokens(
  updates: Partial<{
    accessToken: string;
    idToken: string | null;
    username: string;
    apiUrl: string | null;
    expiresAt: Date | null;
  }>,
): Promise<void> {
  const data = {
    ...(updates.username !== undefined && { username: updates.username }),
    ...(updates.accessToken !== undefined && { accessToken: updates.accessToken }),
    ...(updates.idToken !== undefined && { idToken: updates.idToken }),
    ...(updates.apiUrl !== undefined && { apiUrl: updates.apiUrl }),
    ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
  };

  await db.offRampProviderCredential.upsert({
    where: { provider: "pdax" },
    create: {
      provider: "pdax",
      username: updates.username ?? env().OFFRAMP_USERNAME ?? "",
      accessToken: updates.accessToken ?? env().OFFRAMP_ACCESS_TOKEN ?? "",
      idToken: updates.idToken ?? env().OFFRAMP_ID_TOKEN,
      apiUrl: updates.apiUrl ?? env().OFFRAMP_API_URL,
      expiresAt: updates.expiresAt,
    },
    update: data,
  });
}

/**
 * Refresh the PDAX access token using OFFRAMP_REFRESH_TOKEN.
 * Returns the new access token, or null if refresh is not possible.
 * Persisted tokens are updated in the database on success.
 */
export async function refreshPdaxAccessToken(): Promise<{
  accessToken: string;
  idToken?: string;
} | null> {
  const tokens = await getCredential("pdax");
  const refreshToken = env().OFFRAMP_REFRESH_TOKEN;
  if (!refreshToken || !tokens?.username) {
    log.warn("PDAX refresh token or username not configured; cannot refresh");
    return null;
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (tokens.accessToken) {
      headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    if (tokens.idToken) {
      headers["id_token"] = tokens.idToken;
    }

    const res = await fetch(`${baseUrl()}/pdax-institution/v1/refresh-token`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        username: tokens.username,
        refreshToken,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      log.warn({ status: res.status, body: text }, "PDAX token refresh request failed");
      return null;
    }

    const data = (await res.json()) as {
      access_token?: string;
      accessToken?: string;
      id_token?: string;
      idToken?: string;
    };

    const newAccessToken = data.access_token ?? data.accessToken;
    const newIdToken = data.id_token ?? data.idToken;

    if (!newAccessToken) {
      log.warn("PDAX token refresh response missing access token");
      return null;
    }

    await persistTokens({
      accessToken: newAccessToken,
      ...(newIdToken ? { idToken: newIdToken } : {}),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    log.info("PDAX access token refreshed successfully");
    return { accessToken: newAccessToken, idToken: newIdToken };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ error: message }, "PDAX token refresh threw");
    return null;
  }
}

/**
 * Admin-facing helper: save or replace the stored PDAX credentials.
 */
export async function setPdaxCredential(opts: {
  username: string;
  accessToken: string;
  idToken?: string | null;
  apiUrl?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  await persistTokens({
    ...opts,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000),
  });
}
