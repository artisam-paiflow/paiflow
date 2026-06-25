import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export interface PdaxTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  username?: string;
}

function baseUrl(): string {
  const url = env().OFFRAMP_API_URL ?? "https://api.pdax.ph";
  return url.replace(/\/$/, "");
}

async function getCredential(provider: string): Promise<{
  accessToken: string;
  idToken?: string | null;
  refreshToken?: string | null;
  username?: string;
  apiUrl?: string | null;
  expiresAt?: Date | null;
} | null> {
  const row = await db.offRampProviderCredential.findUnique({
    where: { provider },
  });
  if (row) {
    return {
      accessToken: row.accessToken,
      idToken: row.idToken ?? undefined,
      refreshToken: row.refreshToken ?? undefined,
      username: row.username,
      apiUrl: row.apiUrl,
      expiresAt: row.expiresAt,
    };
  }

  // Fallback to env vars for one-off deployments / migration.
  const accessToken = env().OFFRAMP_ACCESS_TOKEN;
  if (!accessToken) return null;
  return {
    accessToken,
    idToken: env().OFFRAMP_ID_TOKEN ?? undefined,
    refreshToken: env().OFFRAMP_REFRESH_TOKEN ?? undefined,
    username: env().OFFRAMP_USERNAME ?? undefined,
  };
}

/**
 * Build the header object used by every PDAX Institution request.
 */
export async function getPdaxAuthHeaders(): Promise<Record<string, string>> {
  const tokens = await getCredential("pdax");
  if (!tokens) {
    throw new Error("PDAX access token is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${tokens.accessToken}`,
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
    refreshToken: string | null;
    username: string;
    apiUrl: string | null;
    expiresAt: Date | null;
  }>,
): Promise<void> {
  const existing = await db.offRampProviderCredential.findUnique({
    where: { provider: "pdax" },
  });

  const data = {
    ...(updates.username !== undefined && { username: updates.username }),
    ...(updates.accessToken !== undefined && { accessToken: updates.accessToken }),
    ...(updates.idToken !== undefined && { idToken: updates.idToken }),
    ...(updates.refreshToken !== undefined && { refreshToken: updates.refreshToken }),
    ...(updates.apiUrl !== undefined && { apiUrl: updates.apiUrl }),
    ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
  };

  if (existing) {
    await db.offRampProviderCredential.update({
      where: { provider: "pdax" },
      data,
    });
  } else {
    await db.offRampProviderCredential.create({
      data: {
        provider: "pdax",
        username: updates.username ?? env().OFFRAMP_USERNAME ?? "",
        accessToken: updates.accessToken ?? env().OFFRAMP_ACCESS_TOKEN ?? "",
        idToken: updates.idToken ?? env().OFFRAMP_ID_TOKEN,
        refreshToken: updates.refreshToken ?? env().OFFRAMP_REFRESH_TOKEN,
        apiUrl: updates.apiUrl ?? env().OFFRAMP_API_URL,
      },
    });
  }
}

/**
 * Refresh the PDAX access token using the refresh token endpoint.
 * Returns the new access token, or null if refresh is not possible.
 * Persisted tokens are updated in the database on success.
 */
export async function refreshPdaxAccessToken(): Promise<{
  accessToken: string;
  idToken?: string;
} | null> {
  const tokens = await getCredential("pdax");
  if (!tokens?.refreshToken || !tokens?.username) {
    log.warn("PDAX refresh token or username not configured; cannot refresh");
    return null;
  }

  try {
    const res = await fetch(`${baseUrl()}/pdax-institution/v1/refresh-token`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
        ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
      },
      body: JSON.stringify({
        username: tokens.username,
        refreshToken: tokens.refreshToken,
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
      refresh_token?: string;
      refreshToken?: string;
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
      ...(data.refresh_token || data.refreshToken
        ? { refreshToken: data.refresh_token ?? data.refreshToken }
        : {}),
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
  refreshToken?: string | null;
  apiUrl?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  await persistTokens(opts);
}
