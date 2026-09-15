import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { NEXT_PUBLIC_POSTHOG_KEY: "phc_test" as string | undefined, LOG_LEVEL: "silent" },
}));
vi.mock("@/lib/env", () => ({ env: () => mockEnv }));

import { GET, POST } from "@/app/ingest/[...path]/route";

function call(
  handler: typeof GET,
  url: string,
  path: string[],
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  return handler(new NextRequest(url, init), { params: Promise.resolve({ path }) });
}

describe("/ingest proxy", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockEnv.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "ph=1",
          "content-encoding": "gzip",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("forwards only allowlisted headers, never the session cookie or authorization", async () => {
    await call(POST, "https://beta.paiflow.xyz/ingest/e/?compression=gzip-js", ["e"], {
      method: "POST",
      body: "payload",
      headers: {
        cookie: "__Host-authjs.session-token=secret",
        authorization: "Bearer pfk_secret",
        "content-type": "text/plain",
        "user-agent": "tester",
        "x-forwarded-for": "203.0.113.7",
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://us.i.posthog.com/e/?compression=gzip-js");
    const sent = init.headers as Headers;
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("content-type")).toBe("text/plain");
    expect(sent.get("user-agent")).toBe("tester");
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7");
  });

  it("sends static paths to the assets host", async () => {
    await call(GET, "https://beta.paiflow.xyz/ingest/static/array.js", ["static", "array.js"]);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.toString()).toBe("https://us-assets.i.posthog.com/static/array.js");
  });

  it("keeps the upstream host fixed for a crafted path", async () => {
    await call(GET, "https://beta.paiflow.xyz/ingest/x", ["@evil.example", "..", "//evil.example"]);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.host).toBe("us.i.posthog.com");
  });

  it("strips set-cookie and the stale encoding from the response", async () => {
    const res = await call(GET, "https://beta.paiflow.xyz/ingest/flags/", ["flags"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("is a 404 without a PostHog key", async () => {
    mockEnv.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    const res = await call(GET, "https://beta.paiflow.xyz/ingest/e/", ["e"]);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
