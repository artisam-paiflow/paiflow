import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), googleEnabled: true }));
vi.mock("@/lib/auth", () => ({ handlers: { GET: h.get, POST: h.post } }));
vi.mock("@/lib/env", async (original) => {
  const module = await original<typeof import("@/lib/env")>();
  return {
    ...module,
    env: () => ({
      ...module.env(),
      AUTH_URL: "https://app.example",
      GOOGLE_AUTH_ENABLED: h.googleEnabled,
    }),
  };
});
import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.googleEnabled = true;
  h.get.mockResolvedValue(new Response("ok"));
  h.post.mockResolvedValue(new Response("ok"));
});

it("preserves the existing Auth.js request unchanged when Google is disabled", async () => {
  h.googleEnabled = false;
  const request = new NextRequest("http://railway-container:8080/api/auth/session", {
    headers: {
      cookie: "paiflow.session=test-session",
      "x-forwarded-host": "existing-alias.example",
    },
  });
  await GET(request);
  expect(h.get).toHaveBeenCalledWith(request);
  expect(h.get.mock.calls[0]![0]).toBe(request);
});

it("uses the configured origin while preserving OAuth path, query and browser cookies", async () => {
  const request = new NextRequest(
    "http://railway-container:8080/api/auth/callback/google?code=test-code&state=test-state",
    {
      headers: {
        cookie: "paiflow.session=test-session; authjs.pkce.code_verifier=test-verifier",
        "x-forwarded-host": "untrusted.example",
      },
    },
  );
  await GET(request);
  const received = h.get.mock.calls[0]![0] as NextRequest;
  expect(received.url).toBe(
    "https://app.example/api/auth/callback/google?code=test-code&state=test-state",
  );
  expect(received.headers.get("host")).toBe("app.example");
  expect(received.headers.get("x-forwarded-host")).toBe("app.example");
  expect(received.headers.get("x-forwarded-proto")).toBe("https");
  expect(received.headers.get("cookie")).toBe(request.headers.get("cookie"));
});

it("preserves a Credentials POST body and CSRF cookie through canonicalization", async () => {
  const body = "username=existing-user&password=test-only-password&csrfToken=test-csrf";
  await POST(
    new NextRequest("http://railway-container:8080/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "authjs.csrf-token=test-csrf",
      },
      body,
    }),
  );
  const received = h.post.mock.calls[0]![0] as NextRequest;
  expect(received.method).toBe("POST");
  expect(received.url).toBe("https://app.example/api/auth/callback/credentials");
  expect(received.headers.get("cookie")).toBe("authjs.csrf-token=test-csrf");
  expect(received.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
  expect(await received.text()).toBe(body);
});
