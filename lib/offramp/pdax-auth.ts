import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export interface PdaxTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  username?: string;
}

let cachedTokens: PdaxTokens | null = null;

function baseUrl(): string {
  const url = env().OFFRAMP_API_URL ?? "https://api.pdax.ph";
  return url.replace(/\/$/, "");
}

export function getPdaxTokens(): PdaxTokens | null {
  if (cachedTokens) return cachedTokens;

  const accessToken = env().OFFRAMP_ACCESS_TOKEN;
  if (!accessToken) return null;

  cachedTokens = {
    accessToken,
    idToken: env().OFFRAMP_ID_TOKEN,
    refreshToken: env().OFFRAMP_REFRESH_TOKEN,
    username: env().OFFRAMP_USERNAME,
  };
  return cachedTokens;
}

function updateCachedTokens(updates: Partial<PdaxTokens>) {
  if (cachedTokens) {
    cachedTokens = { ...cachedTokens, ...updates };
  } else {
    cachedTokens = {
      accessToken: updates.accessToken ?? env().OFFRAMP_ACCESS_TOKEN ?? "",
      idToken: updates.idToken ?? env().OFFRAMP_ID_TOKEN,
      refreshToken: updates.refreshToken ?? env().OFFRAMP_REFRESH_TOKEN,
      username: updates.username ?? env().OFFRAMP_USERNAME,
    };
  }
}

/**
 * Build the header object used by every PDAX Institution request.
 */
export function getPdaxAuthHeaders(): Record<string, string> {
  const tokens = getPdaxTokens();
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

/**
 * Refresh the PDAX access token using the refresh token endpoint.
 * Returns the new access token, or null if refresh is not possible.
 */
export async function refreshPdaxAccessToken(): Promise<{
  accessToken: string;
  idToken?: string;
} | null> {
  const tokens = getPdaxTokens();
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

    updateCachedTokens({
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
