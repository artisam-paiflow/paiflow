import axe from "axe-core";
import { act, render, screen, within, waitFor } from "@testing-library/react";
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
  it("shows balance discovery and distinguishes contract funds from payment evidence", async () => {
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("schedule")}
        webhookSecret={null}
      />,
    );
    await userEvent.setup().click(screen.getByRole("tab", { name: "Reference" }));
    expect(screen.getByText(/Read contract balances/).textContent).toContain(
      "Requires eligibility checks",
    );
    expect(screen.getByText(`/api/v1/deployments/${DEPLOYMENT_ID}/balances`)).toBeTruthy();
    expect(screen.getByText(/unknown balances are not zero/).textContent).toContain(
      "not Schedule payout availability",
    );
  });
  it("shows deposit instructions before minting a token and includes a request body", async () => {
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("deposit")}
        webhookSecret={null}
      />,
    );
    await userEvent.setup().selectOptions(screen.getByLabelText("Example"), "payment");
    const example = screen.getByText(/curl -X POST/).textContent!;
    expect(example).toContain(`/${DEPLOYMENT_ID}/execute`);
    expect(example).toContain('"from":"G_PAYING_WALLET_ADDRESS"');
    expect(example).toContain('"amount":"10000000"');
    expect(example).toContain("YOUR_API_TOKEN");
    expect(screen.queryByText(/Prepare a payment with a recipient/)).toBeNull();
    expect(screen.queryByText(/Release a timelock early/)).toBeNull();
    expect(screen.queryByTestId("api-token-reveal")).toBeNull();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
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
      const user = userEvent.setup();
      if (trigger === "subscription") {
        await user.selectOptions(screen.getByLabelText("Example"), "subscription");
        expect(
          screen
            .getByRole("link", { name: "Open subscriber allowance approval" })
            .getAttribute("href"),
        ).toBe(`/allowance/${DEPLOYMENT_ID}`);
      } else {
        expect(
          screen.queryByRole("link", { name: "Open subscriber allowance approval" }),
        ).toBeNull();
      }
      if (trigger !== "webhook") expect(screen.queryByTestId("webhook-secret")).toBeNull();
      await user.click(screen.getByRole("tab", { name: "Reference" }));
      expect(screen.getByText(/Check transaction status/)).toBeTruthy();
      if (trigger === "subscription")
        expect(screen.getByText(/Approve a subscription allowance/).textContent).toContain(
          "Subscriber wallet",
        );
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
    expect(screen.queryByTestId("webhook-secret")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Credentials" }));
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
    await user.click(screen.getByRole("tab", { name: "Quickstart" }));
    await user.selectOptions(screen.getByLabelText("Example"), "webhook");
    await user.click(screen.getByRole("button", { name: "Copy escrow reward callback example" }));
    const callback = writeText.mock.calls.at(-1)![0];
    expect(callback).toContain("x-webhook-secret: YOUR_WEBHOOK_SECRET");
    expect(callback).toContain("Idempotency-Key: reward-event-123");
    const payload = JSON.parse(callback.match(/-d '([^']+)'/)![1]!);
    expect(payload).toEqual({ escrow: true, amount: "10000000" });
    expect(screen.getByText(/omitting amount or using/).textContent).toContain(
      "releases the entire available pool",
    );
    expect(callback).not.toContain("synthetic-secret");
    expect(callback).not.toContain("Authorization: Bearer");
    expect(screen.getByText(/interrupted preparation/)).toBeTruthy();
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
    await user.click(screen.getByRole("tab", { name: "Credentials" }));
    await screen.findByText("No active deployment tokens.");
    await user.click(screen.getByRole("button", { name: "Create deployment token" }));
    await user.type(screen.getByLabelText("Label (optional)"), "Rewards backend");
    await user.selectOptions(screen.getByLabelText("Expires"), "30");
    await user.click(screen.getByRole("button", { name: "Create token" }));
    const reveal = await screen.findByTestId("api-token-reveal");
    expect(reveal.className).toContain("ph-no-capture");
    expect(vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")?.[1]?.body).toBe(
      JSON.stringify({ label: "Rewards backend", expiresInDays: 30 }),
    );
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("pfk_synthetic");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("api-token-plaintext")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull());
    await user.click(screen.getByText("Token history"));
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
    await userEvent.setup().click(screen.getByRole("tab", { name: "Credentials" }));
    await screen.findByText("No active deployment tokens.");
  });
});
afterEach(() => vi.unstubAllGlobals());
// #553: an owner who has just revealed a token had no way to find the guide,
// the spec or the collection from the panel.
describe("ApiAccessPanel docs links", () => {
  it("links the guide, the served spec and the collection from Reference", async () => {
    render(
      <ApiAccessPanel
        deploymentId="00000000-0000-4000-8000-000000000000"
        capabilities={null}
        webhookSecret={null}
      />,
    );
    await userEvent.setup().click(screen.getByRole("tab", { name: "Reference" }));
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
describe("API access navigation", () => {
  it("starts with a read-only example and copies connection details", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("deposit")}
        webhookSecret={null}
      />,
    );
    expect(screen.getByRole("tab", { name: "Quickstart" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Read payment events command" }).textContent,
    ).toContain(`/${DEPLOYMENT_ID}/events`);
    expect(screen.queryByLabelText("Label (optional)")).toBeNull();
    expect(screen.queryByText("Available operations")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy Deployment ID" }));
    expect(write).toHaveBeenLastCalledWith(DEPLOYMENT_ID);
    await user.click(screen.getByRole("button", { name: "Copy API base URL" }));
    expect(write).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/v1/deployments/${DEPLOYMENT_ID}`,
    );
    await user.click(screen.getByRole("button", { name: "Manage credentials" }));
    expect(
      screen.getByRole("link", { name: "Manage developer credentials" }).getAttribute("href"),
    ).toBe("/account/developer");
  });
  it("supports keyboard tabs and accessible panels", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("webhook")}
        webhookSecret="synthetic-secret"
      />,
    );
    const quickstart = screen.getByRole("tab", { name: "Quickstart" });
    quickstart.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Credentials" }));
    expect(screen.getByRole("tabpanel", { name: "Credentials" })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.keyboard("{End}");
    expect(screen.getByRole("tabpanel", { name: "Reference" })).toBeTruthy();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(quickstart);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.keyboard("{ArrowLeft}{Home}");
    expect(document.activeElement).toBe(quickstart);
  });
  it("keeps inactive tokens in history and active tokens visible", async () => {
    const user = userEvent.setup();
    const metadata = {
      createdAt: "2026-01-01T00:00:00Z",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { ...metadata, id: "active", tokenPrefix: "pfk_active", label: "Production" },
            {
              ...metadata,
              id: "expired",
              tokenPrefix: "pfk_expired",
              label: "Old integration",
              expiresAt: "2020-01-01T00:00:00Z",
            },
            {
              ...metadata,
              id: "revoked",
              tokenPrefix: "pfk_revoked",
              label: "Retired integration",
              revokedAt: "2020-01-01T00:00:00Z",
            },
          ],
        }),
      ),
    );
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("deposit")}
        webhookSecret={null}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Credentials" }));
    expect(
      await within(screen.getByRole("list", { name: "Active deployment tokens" })).findByText(
        "Production",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Active deployment tokens" })).queryByText(
        "Old integration",
      ),
    ).toBeNull();
    const history = screen.getByText("Token history").closest("details")!;
    expect(history.open).toBe(false);
    await user.click(screen.getByText("Token history"));
    expect(history.open).toBe(true);
    expect(screen.getByRole("list", { name: "Token history" }).textContent).toContain(
      "Old integration",
    );
  });
  it("does not reveal a token whose creation finishes after leaving Credentials", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : new Response(JSON.stringify({ data: [] })),
    );
    render(
      <ApiAccessPanel
        deploymentId={DEPLOYMENT_ID}
        capabilities={capabilities("deposit")}
        webhookSecret={null}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "Credentials" }));
    await user.click(screen.getByRole("button", { name: "Create deployment token" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));
    await user.click(screen.getByRole("tab", { name: "Reference" }));
    await act(async () =>
      finish(new Response(JSON.stringify({ data: { id: "token-id", token: "pfk_synthetic" } }))),
    );
    await user.click(screen.getByRole("tab", { name: "Credentials" }));
    expect(screen.queryByTestId("api-token-reveal")).toBeNull();
    expect(screen.queryByText("pfk_synthetic")).toBeNull();
  });
});
