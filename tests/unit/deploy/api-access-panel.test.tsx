import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiAccessPanel from "@/components/deploy/api-access-panel";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

// #553: an owner who has just revealed a token had no way to find the guide,
// the spec or the collection from the panel.
describe("ApiAccessPanel docs links", () => {
  it("links the guide, the served spec and the collection, each in a new tab", () => {
    render(<ApiAccessPanel deploymentId="00000000-0000-4000-8000-000000000000" />);
    const links = within(screen.getByTestId("api-docs-links")).getAllByRole("link");

    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Developer guide", "https://paiflow.gitbook.io/paiflow-docs/reference/api"],
      ["OpenAPI spec", "/api/v1/openapi.json"],
      [
        "Postman collection",
        "https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json",
      ],
    ]);
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});
