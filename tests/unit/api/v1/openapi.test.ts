/**
 * The drift guard for the hand-written OpenAPI document (#470): a v1 route added without a spec
 * entry, a committed copy that falls behind, an example that no longer parses, or an error table
 * that disagrees with `lib/errors.ts` fails the suite.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { z } from "zod";

// No Redis: the rate limit runs on its in-memory bucket.
vi.mock("@/lib/redis", () => ({ redis: () => null }));

import { GET } from "@/app/api/v1/openapi.json/route";
import { APP_ERROR_STATUS } from "@/lib/errors";
import { ERROR_STATUS, examples, openApiDocument } from "@/lib/api/v1/openapi";
import {
  ApiTokenSchema,
  CreateApiTokenSchema,
  CreatedApiTokenSchema,
  ExecutePrepareSchema,
  ExecutePreparedSchema,
  ExecuteSubmitSchema,
  ExecuteSubmittedSchema,
  ListEventsResponseSchema,
} from "@/lib/api/v1/schema";

const root = process.cwd();
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Operations = Record<string, Record<string, unknown>>;
const paths = openApiDocument.paths as Operations;

/** `path/method` pairs exported by every `route.ts` under an `app/api` subtree. */
function routeOperations(dir: string): string[] {
  const base = path.join(root, "app");
  return (fs.readdirSync(path.join(base, dir), { recursive: true }) as string[])
    .filter((f) => path.basename(f) === "route.ts")
    .flatMap((f) => {
      const source = fs.readFileSync(path.join(base, dir, f), "utf8");
      const urlPath = path.posix
        .join("/", dir, path.dirname(f).split(path.sep).join("/"))
        .replace(/\[(\w+)\]/g, "{$1}");
      return HTTP_METHODS.filter((m) =>
        new RegExp(`export\\s+(const|async\\s+function|function)\\s+${m}\\b`).test(source),
      ).map((m) => `${urlPath} ${m.toLowerCase()}`);
    })
    .sort();
}

function specOperations(prefix: string): string[] {
  return Object.entries(paths)
    .filter(([p]) => p.startsWith(prefix))
    .flatMap(([p, ops]) => Object.keys(ops).map((m) => `${p} ${m}`))
    .sort();
}

describe("OpenAPI document", () => {
  it("matches the committed docs/api/openapi.json (run `pnpm api:openapi`)", () => {
    const committed = JSON.parse(
      fs.readFileSync(path.join(root, "docs/api/openapi.json"), "utf8"),
    ) as unknown;
    expect(committed).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  });

  it("documents every /api/v1 route and method, and nothing that does not exist", () => {
    const routes = routeOperations("api/v1");
    expect(routes.length).toBeGreaterThan(0);
    expect(specOperations("/api/v1/")).toEqual(routes);
  });

  it("documents the owner-session token routes as they exist", () => {
    const routes = routeOperations("api/deployments/[id]/api-tokens");
    expect(specOperations("/api/deployments/{id}/api-tokens")).toEqual(routes);
  });

  it("has an error table equal to lib/errors.ts", () => {
    expect({ ...ERROR_STATUS }).toEqual(APP_ERROR_STATUS);
  });

  it("resolves every $ref", () => {
    const refs = JSON.stringify(openApiDocument).match(/"#\/components\/schemas\/\w+"/g) ?? [];
    const schemas = openApiDocument.components.schemas as Record<string, unknown>;
    for (const ref of refs) {
      expect(schemas).toHaveProperty(ref.slice(1, -1).split("/").pop()!);
    }
  });

  const parses: Array<[string, z.ZodTypeAny, unknown]> = [
    ["execute request", ExecutePrepareSchema, examples.executeRequest],
    ["execute response", ExecutePreparedSchema, examples.executeResponse.data],
    ["submit request", ExecuteSubmitSchema, examples.submitRequest],
    ["submit SUCCESS", ExecuteSubmittedSchema, examples.submitSuccess.data],
    ["submit PENDING", ExecuteSubmittedSchema, examples.submitPending.data],
    ["submit FAILED", ExecuteSubmittedSchema, examples.submitFailed.data],
    ["events page", ListEventsResponseSchema, examples.eventsResponse.data],
    ["token create request", CreateApiTokenSchema, examples.createTokenRequest],
    ["token create response", CreatedApiTokenSchema, examples.createTokenResponse.data],
    ["token list item", ApiTokenSchema, examples.tokenListResponse.data[0]],
  ];
  it.each(parses)("example %s parses with its Zod schema", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("serves the document without a token or the data envelope", async () => {
    const res = await GET(new Request("http://localhost/api/v1/openapi.json") as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify(openApiDocument)));
  });
});

describe("Postman collection", () => {
  const collection = JSON.parse(
    fs.readFileSync(path.join(root, "docs/api/paiflow-api-v1.postman_collection.json"), "utf8"),
  ) as {
    item: Array<{
      name: string;
      request: { method: string; url: { path: string[] } };
      response: Array<{ name: string; body: string }>;
    }>;
  };

  it("has a request for every /api/v1 operation", () => {
    const requests = collection.item
      .map(({ request }) => {
        const p = `/${request.url.path.join("/")}`.replace("{{deploymentId}}", "{id}");
        return `${p} ${request.method.toLowerCase()}`;
      })
      .sort();
    expect(requests).toEqual(specOperations("/api/v1/"));
  });

  it("saves the spec's examples as its example responses", () => {
    const body = (item: string, response: string) =>
      JSON.parse(
        collection.item.find((i) => i.name === item)!.response.find((r) => r.name === response)!
          .body,
      ) as unknown;
    expect(body("Prepare execute", "200 OK")).toEqual(examples.executeResponse);
    expect(body("Submit execute", "200 SUCCESS")).toEqual(examples.submitSuccess);
    expect(body("Submit execute", "200 FAILED")).toEqual(examples.submitFailed);
    expect(body("List events", "200 OK")).toEqual(examples.eventsResponse);
  });
});
