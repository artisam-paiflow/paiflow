import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ApiAccessPanel from "@/components/deploy/api-access-panel";
import { capabilities, DEPLOYMENT_ID } from "./api-access-fixtures";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});

describe("deployment integration instructions", () => {
  it("shows deposit instructions before minting a token and includes a request body", async () => {
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("deposit")}
        webhookSecret={null}
      />,
    );
    const example = screen.getByText(/curl -X POST/).textContent!;
    expect(example).toContain(`/${DEPLOYMENT_ID}/execute`);
    expect(example).toContain('"from":"G_PAYING_WALLET_ADDRESS"');
    expect(example).toContain('"amount":"10000000"');
    expect(example).toContain("YOUR_API_TOKEN");
    expect(screen.queryByText(/Prepare a payment with a recipient/)).toBeNull();
    expect(screen.queryByText(/Release a timelock early/)).toBeNull();
    expect(screen.queryByTestId("api-token-reveal")).toBeNull();
    await screen.findByText("NO API TOKENS YET.");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it.each(["webhook", "subscription", "payroll", "schedule", "oracle", "unknown"] as const)(
    "offers monitoring without deposit execution for %s",
    async (trigger) => {
      render(
        <ApiAccessPanel
          deploymentId={DEPLOYMENT_ID}
          capabilities={capabilities(trigger)}
          webhookSecret="synthetic-secret"
        />,
      );
      expect(screen.getByText(/curl '.*\/events'/).textContent).toContain("YOUR_API_TOKEN");
      expect(screen.queryByText(/\/execute/)).toBeNull();
      expect(screen.queryByText(/Prepare and submit a payment/)).toBeNull();
      expect(screen.getByText(/Check transaction status/)).toBeTruthy();
      if (trigger === "subscription") {
        expect(
          screen
            .getByRole("link", { name: "Open subscriber allowance approval" })
            .getAttribute("href"),
        ).toBe(`/allowance/${DEPLOYMENT_ID}`);
        expect(screen.getByText(/Approve a subscription allowance/).textContent).toContain(
          "Subscriber wallet",
        );
      } else {
        expect(
          screen.queryByRole("link", { name: "Open subscriber allowance approval" }),
        ).toBeNull();
      }
      if (trigger !== "webhook") expect(screen.queryByTestId("webhook-secret")).toBeNull();
      await screen.findByText("NO API TOKENS YET.");
    },
  );

  it("separates webhook credentials, masks the secret and copies the correct values", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("webhook")}
        webhookSecret="synthetic-secret"
      />,
    );
    const secret = screen.getByTestId("webhook-secret");
    expect(secret.className).toContain("ph-no-capture");
    expect(secret.textContent).not.toContain("synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Show secret" }));
    expect(secret.textContent).toContain("synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Hide secret" }));
    expect(secret.textContent).not.toContain("synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Copy secret" }));
    expect(writeText).toHaveBeenLastCalledWith("synthetic-secret");
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    expect(writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/webhooks/${DEPLOYMENT_ID}`,
    );
    await user.click(screen.getByRole("button", { name: "Copy escrow reward callback example" }));
    const callback = writeText.mock.calls.at(-1)![0];
    expect(callback).toContain("x-webhook-secret: YOUR_WEBHOOK_SECRET");
    expect(callback).toContain("Idempotency-Key: reward-event-123");
    expect(callback).toContain('"escrow":true');
    expect(callback).not.toContain("synthetic-secret");
    expect(callback).not.toContain("Authorization: Bearer");
    expect(screen.getByText(/interrupted preparation/)).toBeTruthy();
  });

  it("includes prerequisites for eligible payouts and early release", async () => {
    const data = capabilities("deposit");
    data.operations.payouts = {
      status: "conditional",
      authentication: "deployment_token",
      requirements: ["Eligible immediate path and zero Pay balance required."],
      nodeIds: ["pay"],
    };
    data.operations.releaseEarly = {
      status: "supported",
      authentication: "deployment_token",
      requirements: ["Held funds required; token authorizes a relayer-signed release."],
      nodeIds: ["hold"],
    };
    const user = userEvent.setup();
    render(
      <ApiAccessPanel deploymentId={DEPLOYMENT_ID} capabilities={data} webhookSecret={null} />,
    );
    const summary = screen.getByText(/Prepare a payment with a recipient/);
    expect(summary.textContent).toContain("Requires eligibility checks");
    await user.click(summary);
    expect(summary.closest("details")!.open).toBe(true);
    expect(screen.getByText(/Eligible immediate path/)).toBeTruthy();
    expect(screen.getByText(/token authorizes a relayer-signed release/)).toBeTruthy();
  });

  it("retains token creation, one-time display, expiry and revocation for a webhook", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText");
    const token = {
      id: "token-id",
      tokenPrefix: "pfk_123",
      token: "pfk_synthetic",
      label: "Rewards backend",
      createdAt: "2026-10-08T00:00:00Z",
      lastUsedAt: null,
      expiresAt: "2026-11-07T00:00:00Z",
      revokedAt: null,
    };
    let created = false;
    let revoked = false;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        created = true;
        return new Response(JSON.stringify({ data: token }));
      }
      if (init?.method === "DELETE") {
        revoked = true;
        return new Response(JSON.stringify({ data: {} }));
      }
      return new Response(
        JSON.stringify({
          data: created ? [{ ...token, revokedAt: revoked ? "2026-10-08T01:00:00Z" : null }] : [],
        }),
      );
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("webhook")}
        webhookSecret="synthetic-secret"
      />,
    );
    await screen.findByText("NO API TOKENS YET.");
    await user.type(screen.getByLabelText("Label (optional)"), "Rewards backend");
    await user.selectOptions(screen.getByLabelText("Expires"), "30");
    await user.click(screen.getByRole("button", { name: /CREATE TOKEN/ }));
    const reveal = await screen.findByTestId("api-token-reveal");
    expect(reveal.className).toContain("ph-no-capture");
    expect(screen.getByTestId("api-token-curl").textContent).toContain(
      `/api/v1/deployments/${DEPLOYMENT_ID}/events`,
    );
    expect(screen.getByTestId("api-token-curl").textContent).not.toContain("/execute");
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(
      JSON.stringify({ label: "Rewards backend", expiresInDays: 30 }),
    );
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("pfk_synthetic");
    await user.click(screen.getByRole("button", { name: "DONE" }));
    expect(screen.queryByTestId("api-token-plaintext")).toBeNull();
    await user.click(screen.getByRole("button", { name: /REVOKE/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /REVOKE/ })).toBeNull());
    expect(screen.getByText("REVOKED")).toBeTruthy();
    vi.mocked(window.confirm).mockRestore();
  });

  it("does not present operations or webhook credentials in a mismatched environment", async () => {
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={null}
        webhookSecret="synthetic-secret"
      />,
    );
    expect(screen.getByText(/different network/)).toBeTruthy();
    expect(screen.queryByTestId("webhook-secret")).toBeNull();
    expect(screen.queryByText(/curl /)).toBeNull();
    await screen.findByText("NO API TOKENS YET.");
  });
});
afterEach(() => vi.unstubAllGlobals());

// #553: an owner who has just revealed a token had no way to find the guide,
// the spec or the collection from the panel.
describe("ApiAccessPanel docs links", () => {
  it("links the guide, the served spec and the collection, each in a new tab", () => {
    render(
      <ApiAccessPanel
        deploymentId="00000000-0000-4000-8000-000000000000"
        capabilities={null}
        webhookSecret={null}
      />,
    );
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
