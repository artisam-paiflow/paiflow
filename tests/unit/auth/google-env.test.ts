import { afterEach, describe, expect, it, vi } from "vitest";
const KEYS = [
  "GOOGLE_AUTH_ENABLED",
  "ALLOW_GOOGLE_REGISTRATION",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_URL",
];
afterEach(() => {
  for (const key of KEYS) delete process.env[key];
  vi.resetModules();
});
async function parse(values: Record<string, string> = {}) {
  Object.assign(process.env, values);
  vi.resetModules();
  return (await import("@/lib/env")).env();
}
describe("Google environment boundaries", () => {
  it("defaults both switches off without provider credentials", async () => {
    expect(await parse()).toMatchObject({
      GOOGLE_AUTH_ENABLED: false,
      ALLOW_GOOGLE_REGISTRATION: false,
      ALLOW_PUBLIC_REGISTRATION: false,
    });
  });
  it("requires credentials and refuses Google registration without availability", async () => {
    await expect(parse({ GOOGLE_AUTH_ENABLED: "true" })).rejects.toThrow("GOOGLE_CLIENT_ID");
    delete process.env.GOOGLE_AUTH_ENABLED;
    await expect(parse({ ALLOW_GOOGLE_REGISTRATION: "true" })).rejects.toThrow(
      "requires GOOGLE_AUTH_ENABLED",
    );
  });
  it("pins OAuth to a canonical secure origin", async () => {
    const credentials = {
      GOOGLE_AUTH_ENABLED: "true",
      GOOGLE_CLIENT_ID: "local-test-id",
      GOOGLE_CLIENT_SECRET: "synthetic-test-only",
    };
    for (const AUTH_URL of [
      "http://public.example",
      "https://u:p@app.example",
      "https://app.example/path",
      "https://app.example?x=1",
    ])
      await expect(parse({ ...credentials, AUTH_URL })).rejects.toThrow("HTTPS origin");
    expect(await parse({ ...credentials, AUTH_URL: "https://app.example" })).toMatchObject({
      GOOGLE_AUTH_ENABLED: true,
      ALLOW_PUBLIC_REGISTRATION: false,
    });
  });
});
