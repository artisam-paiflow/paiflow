/**
 * The no-account sandbox session (Instawards D1: a public testnet URL where the
 * Swap block is usable without an account).
 *
 * What must hold: the route is off unless SANDBOX_ENABLED, it is capped per IP
 * so new throwaway identities cannot be minted in a loop, and the session it
 * hands out is a SANDBOX-role user owning one swap flow, reachable only through
 * a single-use ticket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockSaveChallenge, mockRateLimit, mockAudit } = vi.hoisted(() => ({
  mockDb: { user: { create: vi.fn() } },
  mockSaveChallenge: vi.fn(),
  mockRateLimit: vi.fn(async (_key: string) => ({ ok: true, remaining: 4, resetAt: 0 })),
  mockAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));
vi.mock("@/lib/passkey/challenges", () => ({ saveChallenge: mockSaveChallenge }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: mockRateLimit,
  clientIp: vi.fn(() => "203.0.113.9"),
}));

function req() {
  return new Request("http://localhost/api/auth/sandbox", { method: "POST" }) as never;
}

// env() memoizes its parse, so the route has to be imported after the flag is
// set for the case at hand.
async function post() {
  vi.resetModules();
  const { POST } = await import("@/app/api/auth/sandbox/route");
  return POST(req());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRateLimit.mockResolvedValue({ ok: true, remaining: 4, resetAt: 0 });
  mockDb.user.create.mockResolvedValue({ id: "user-sandbox-1", username: "sandbox-deadbeef" });
  process.env.SANDBOX_ENABLED = "true";
});

afterEach(() => {
  delete process.env.SANDBOX_ENABLED;
});

describe("POST /api/auth/sandbox", () => {
  it("is refused when SANDBOX_ENABLED is not set", async () => {
    delete process.env.SANDBOX_ENABLED;
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockDb.user.create).not.toHaveBeenCalled();
  });

  it("creates a SANDBOX user owning one swap flow and returns a single-use ticket", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { ticket: string; username: string } };

    const arg = mockDb.user.create.mock.calls[0]![0] as {
      data: {
        username: string;
        passwordHash: string;
        role: string;
        flows: {
          create: { name: string; templateKind: string; graph: { nodes: { type: string }[] } };
        };
      };
    };
    expect(arg.data.role).toBe("SANDBOX");
    expect(arg.data.username).toMatch(/^sandbox-[0-9a-f]{8}$/);
    expect(arg.data.flows.create.templateKind).toBe("SWAPPER");
    expect(arg.data.flows.create.graph.nodes.map((n) => n.type)).toContain("swap");

    // No argon2 over a random string: that would be a 19 MiB, 2-pass amplifier
    // on an unauthenticated endpoint. The stored value is a sentinel that
    // verifyPassword() can never match, so no password opens the account.
    expect(arg.data.passwordHash).toBe("sandbox:no-password-login");

    expect(mockSaveChallenge).toHaveBeenCalledWith("ticket", body.data.ticket, "user-sandbox-1");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SANDBOX_CREATE", userId: "user-sandbox-1" }),
    );
  });

  it("is capped per IP so throwaway identities cannot be minted in a loop", async () => {
    mockRateLimit.mockResolvedValue({ ok: false, remaining: 0, resetAt: 0 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith("sandbox:203.0.113.9", 5, 600);
  });

  it("also caps the instance as a whole, since the client controls its own IP header", async () => {
    // clientIp() reads the first X-Forwarded-For entry, which the caller sets
    // freely — so the per-IP cap alone is not a real ceiling.
    mockRateLimit.mockImplementation(async (key: string) => ({
      ok: key !== "sandbox:global",
      remaining: 0,
      resetAt: 0,
    }));
    const res = await post();
    expect(res.status).toBe(429);
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith("sandbox:global", 120, 3600);
  });
});
