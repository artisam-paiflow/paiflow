import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    deploymentApiToken: { findUnique: vi.fn(), update: vi.fn() },
    devApiToken: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import { requireDeploymentToken } from "@/lib/api/v1/auth";
import { hashApiToken } from "@/lib/auth/api-token";
import { AppError } from "@/lib/errors";

const DEPLOYMENT_A = "11111111-1111-1111-1111-111111111111";
const DEPLOYMENT_B = "22222222-2222-2222-2222-222222222222";
const TOKEN_ID = "33333333-3333-3333-3333-333333333333";
const PLAINTEXT = `pfk_${"ab".repeat(32)}`;
const GENERIC = "A valid API token for this deployment is required";

function req(headers: Record<string, string>): NextRequest {
  const h = new Headers(headers);
  return { headers: h } as unknown as NextRequest;
}

const bearer = (token: string) => req({ authorization: `Bearer ${token}` });

function tokenRow(
  overrides: {
    revokedAt?: Date | null;
    expiresAt?: Date | null;
    deploymentId?: string;
    owner?: { isActive: boolean; role: "USER" | "ADMIN" | "SANDBOX" };
  } = {},
) {
  const deploymentId = overrides.deploymentId ?? DEPLOYMENT_A;
  return {
    id: TOKEN_ID,
    deploymentId,
    createdById: "44444444-4444-4444-4444-444444444444",
    tokenHash: hashApiToken(PLAINTEXT),
    tokenPrefix: PLAINTEXT.slice(0, 12),
    label: "partner",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    lastUsedAt: null,
    expiresAt: overrides.expiresAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    deployment: {
      id: deploymentId,
      status: "CONFIRMED",
      owner: overrides.owner ?? { isActive: true, role: "USER" },
    },
  };
}

async function refusal(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => {
      throw new Error("expected a refusal");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

async function expectUnauthenticated(p: Promise<unknown>) {
  const err = await refusal(p);
  expect(err.code).toBe("UNAUTHENTICATED");
  expect(err.message).toBe(GENERIC);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.deploymentApiToken.update.mockResolvedValue({});
});

describe("requireDeploymentToken", () => {
  it("returns the token and its deployment, without the hash or the owner", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow());

    const { token, deployment } = await requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A);

    expect(mockDb.deploymentApiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: crypto.createHash("sha256").update(PLAINTEXT).digest("hex") },
      }),
    );
    expect(token.id).toBe(TOKEN_ID);
    expect(token).not.toHaveProperty("tokenHash");
    expect(deployment).toEqual({ id: DEPLOYMENT_A, status: "CONFIRMED" });
    expect(mockDb.deploymentApiToken.update).toHaveBeenCalledWith({
      where: { id: TOKEN_ID },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("accepts a token whose expiry is still in the future", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(
      tokenRow({ expiresAt: new Date(Date.now() + 60_000) }),
    );
    await expect(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A)).resolves.toBeTruthy();
  });

  it("does not fail the request when the lastUsedAt stamp fails", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow());
    mockDb.deploymentApiToken.update.mockRejectedValue(new Error("db down"));
    await expect(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A)).resolves.toBeTruthy();
  });

  describe("refuses with one generic UNAUTHENTICATED", () => {
    it("when the Authorization header is missing", async () => {
      await expectUnauthenticated(requireDeploymentToken(req({}), DEPLOYMENT_A));
      expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ["no Bearer scheme", PLAINTEXT],
      ["Basic scheme", `Basic ${PLAINTEXT}`],
      ["empty bearer", "Bearer "],
      ["trailing junk", `Bearer ${PLAINTEXT} extra`],
      ["wrong prefix", `Bearer pkx_${"ab".repeat(32)}`],
      ["too short", `Bearer pfk_${"ab".repeat(31)}`],
      ["uppercase hex", `Bearer pfk_${"AB".repeat(32)}`],
    ])("when the header is malformed (%s)", async (_name, value) => {
      await expectUnauthenticated(
        requireDeploymentToken(req({ authorization: value }), DEPLOYMENT_A),
      );
      expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
    });

    it("when the token is unknown", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(null);
      await expectUnauthenticated(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A));
    });

    it("when the token is revoked", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow({ revokedAt: new Date() }));
      await expectUnauthenticated(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A));
    });

    it("when the token has expired", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(
        tokenRow({ expiresAt: new Date(Date.now() - 1) }),
      );
      await expectUnauthenticated(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A));
    });

    it("when a token for deployment A is presented on deployment B", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(
        tokenRow({ deploymentId: DEPLOYMENT_A }),
      );
      await expectUnauthenticated(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_B));
      expect(mockDb.deploymentApiToken.update).not.toHaveBeenCalled();
    });

    it("when the deployment owner is deactivated", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(
        tokenRow({ owner: { isActive: false, role: "USER" } }),
      );
      await expectUnauthenticated(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A));
    });

    it("when given a user-scoped DevApiToken plaintext", async () => {
      const devToken = `pkdev_${"cd".repeat(32)}`;
      mockDb.devApiToken.findUnique.mockResolvedValue({ id: "dev", revokedAt: null });
      await expectUnauthenticated(requireDeploymentToken(bearer(devToken), DEPLOYMENT_A));
      await expectUnauthenticated(
        requireDeploymentToken(req({ "x-dev-api-secret": devToken }), DEPLOYMENT_A),
      );
      expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
      expect(mockDb.devApiToken.findUnique).not.toHaveBeenCalled();
    });

    it("when given an opaque shared secret, as a bearer or in x-dev-api-secret", async () => {
      const secret = "shared-dev-secret-value";
      await expectUnauthenticated(requireDeploymentToken(bearer(secret), DEPLOYMENT_A));
      await expectUnauthenticated(
        requireDeploymentToken(req({ "x-dev-api-secret": secret }), DEPLOYMENT_A),
      );
      expect(mockDb.deploymentApiToken.findUnique).not.toHaveBeenCalled();
    });

    it("when a valid token sits in x-dev-api-secret instead of Authorization", async () => {
      mockDb.deploymentApiToken.findUnique.mockResolvedValue(tokenRow());
      await expectUnauthenticated(
        requireDeploymentToken(req({ "x-dev-api-secret": PLAINTEXT }), DEPLOYMENT_A),
      );
    });
  });

  it("refuses a sandbox-owned deployment with FORBIDDEN", async () => {
    mockDb.deploymentApiToken.findUnique.mockResolvedValue(
      tokenRow({ owner: { isActive: true, role: "SANDBOX" } }),
    );
    const err = await refusal(requireDeploymentToken(bearer(PLAINTEXT), DEPLOYMENT_A));
    expect(err.code).toBe("FORBIDDEN");
    expect(mockDb.deploymentApiToken.update).not.toHaveBeenCalled();
  });
});
