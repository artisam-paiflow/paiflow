/**
 * PATCH /api/admin/users/:id ends the target's sessions when it should (#519).
 *
 * Sessions are JWTs, so the only thing that signs a user out is incrementing
 * `User.sessionVersion`. Before this, deactivate did nothing at all to a live
 * session and resetPassword deleted rows from a table that is always empty.
 * The cases that must NOT bump matter as much: an admin unlocking an account
 * should not sign its owner out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb, mockRequireSession, mockHashPassword, mockAudit } = vi.hoisted(() => ({
  mockDb: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { deleteMany: vi.fn() },
  },
  mockRequireSession: vi.fn(),
  mockHashPassword: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => ({
  requireSession: mockRequireSession,
  hashPassword: mockHashPassword,
}));
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));

import { PATCH } from "@/app/api/admin/users/[id]/route";

const ADMIN = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", username: "root", role: "ADMIN" };
const TARGET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function target(overrides: Record<string, unknown> = {}) {
  return { id: TARGET_ID, username: "someone", role: "USER", isActive: true, ...overrides };
}

function req(body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/users/${TARGET_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ctx = (id = TARGET_ID) => ({ params: Promise.resolve({ id }) });

async function patchedData(body: unknown): Promise<Record<string, unknown>> {
  const res = await PATCH(req(body), ctx());
  expect(res.status).toBe(200);
  expect(mockDb.user.update).toHaveBeenCalledTimes(1);
  return mockDb.user.update.mock.calls[0]![0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue(ADMIN);
  mockHashPassword.mockResolvedValue("argon2-hash");
  mockDb.user.findUnique.mockResolvedValue(target());
  mockDb.user.update.mockImplementation(async () => target());
});

describe("PATCH /api/admin/users/:id and sessionVersion", () => {
  it("bumps on deactivate", async () => {
    const data = await patchedData({ isActive: false });
    expect(data).toMatchObject({ isActive: false, sessionVersion: { increment: 1 } });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_USER_DEACTIVATE" }),
    );
  });

  it("bumps on a role change", async () => {
    const data = await patchedData({ role: "ADMIN" });
    expect(data).toMatchObject({ role: "ADMIN", sessionVersion: { increment: 1 } });
  });

  it("bumps on a demotion, which is the case the token's stale role made dangerous", async () => {
    mockDb.user.findUnique.mockResolvedValue(target({ role: "ADMIN" }));
    const data = await patchedData({ role: "USER" });
    expect(data).toMatchObject({ role: "USER", sessionVersion: { increment: 1 } });
  });

  it("bumps on resetPassword", async () => {
    const data = await patchedData({ resetPassword: "correct horse battery" });
    expect(data).toMatchObject({
      passwordHash: "argon2-hash",
      sessionVersion: { increment: 1 },
    });
  });

  it("bumps once, not once per reason", async () => {
    const data = await patchedData({
      isActive: false,
      role: "ADMIN",
      resetPassword: "correct horse battery",
    });
    expect(data.sessionVersion).toEqual({ increment: 1 });
  });

  it("does not bump on unlock", async () => {
    const data = await patchedData({ unlock: true });
    expect(data).toEqual({ failedLogins: 0, lockedUntil: null });
  });

  it("does not bump on reactivate", async () => {
    mockDb.user.findUnique.mockResolvedValue(target({ isActive: false }));
    const data = await patchedData({ isActive: true });
    expect(data).toEqual({ isActive: true });
  });

  it("does not bump when the role sent is the role the user already has", async () => {
    const data = await patchedData({ role: "USER" });
    expect(data).not.toHaveProperty("sessionVersion");
  });

  it("no longer touches the Session table, which JWT sessions never populate", async () => {
    await patchedData({ resetPassword: "correct horse battery" });
    expect(mockDb.session.deleteMany).not.toHaveBeenCalled();
  });

  it("deactivating a sandbox account bumps: it is the only lever an admin has there", async () => {
    mockDb.user.findUnique.mockResolvedValue(target({ role: "SANDBOX" }));
    const data = await patchedData({ isActive: false });
    expect(data).toMatchObject({ isActive: false, sessionVersion: { increment: 1 } });
  });

  it("still refuses to deactivate the caller, and writes nothing", async () => {
    mockDb.user.findUnique.mockResolvedValue(target({ id: ADMIN.id }));
    const res = await PATCH(req({ isActive: false }), ctx(ADMIN.id));
    expect(res.status).toBe(403);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });
});
