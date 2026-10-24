import { render, screen, within, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import DeveloperTokenPanel from "@/components/developer/token-panel";
import type { DeveloperToken } from "@/lib/developer-tokens/schema";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = `pfd_${"a".repeat(64)}`;
const token = (extra: Partial<DeveloperToken> = {}): DeveloperToken => ({
  id: ID,
  tokenPrefix: "pfd_aaaaaaaa",
  label: "Campus backend",
  permission: "READ_ONLY",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  deploymentIds: [A],
  ...extra,
});
const deployment = (id: string) => ({
  id,
  flowName: id === A ? "Donations" : "Memberships",
  network: "testnet",
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });
let rows: DeveloperToken[];
let requests: { url: string; method: string; body: unknown }[];
let mutationError: { error: { message: string; fields?: Record<string, string[]> } } | null;
let failDeployments: boolean;
let failTokens: boolean;
let emptyDeployments: boolean;
let paginateTokens: boolean;
let failMutationNetwork: boolean;

beforeEach(() => {
  rows = [];
  requests = [];
  mutationError = null;
  failDeployments = false;
  failTokens = false;
  emptyDeployments = false;
  paginateTokens = false;
  failMutationNetwork = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ url: input, method, body });
      if (method !== "GET" && failMutationNetwork) throw new Error("network");
      if (method !== "GET" && mutationError)
        return new Response(JSON.stringify(mutationError), { status: 422 });
      if (input.startsWith("/api/developer-tokens/deployments")) {
        if (failDeployments) throw new Error("network");
        return response({
          items:
            emptyDeployments || input.includes("search=missing")
              ? []
              : input.includes("search=Memberships")
                ? [deployment(B)]
                : input.includes("cursor=")
                  ? [deployment(B)]
                  : [deployment(A)],
          nextCursor:
            !emptyDeployments && !input.includes("cursor=") && !input.includes("search=")
              ? A
              : null,
        });
      }
      if (method === "POST") {
        const data = body as {
          label?: string;
          deploymentIds: string[];
          permission: DeveloperToken["permission"];
        };
        const metadata = token({
          label: data.label ?? null,
          deploymentIds: data.deploymentIds,
          permission: data.permission,
        });
        rows = [metadata];
        return response({ ...metadata, token: SECRET }, 201);
      }
      if (method === "PATCH") {
        const updated = token({
          ...rows[0],
          deploymentIds: (body as { deploymentIds: string[] }).deploymentIds,
        });
        rows = [updated];
        return response(updated);
      }
      if (method === "DELETE") {
        const updated = token({ ...rows[0], revokedAt: "2026-01-02T00:00:00.000Z" });
        rows = [updated];
        return response(updated);
      }
      if (input.endsWith(`/${ID}`)) return response(rows[0]);
      if (failTokens) throw new Error("network");
      return response({
        items: paginateTokens
          ? input.includes("cursor=")
            ? rows.slice(1)
            : rows.slice(0, 1)
          : rows,
        nextCursor: paginateTokens && !input.includes("cursor=") ? ID : null,
      });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const ready = async () => {
  await screen.findByRole("button", { name: "Refresh token list" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create token" }).matches(":disabled")).toBe(false),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Create token" }));
  await screen.findByRole("checkbox", { name: /Donations/ });
  for (const details of screen.queryAllByText(/^View details for /)) await user.click(details);
};
const form = () => within(screen.getByRole("form", { name: "Create developer token" }));

// Capture a real response snapshot but delay delivery to exercise ordering.
function deferResponse(matches: (url: string, method: string) => boolean) {
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error("Missing fetch mock");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const result = await original(input, init);
    if (matches(String(input), init?.method ?? "GET")) await gate;
    return result;
  });
  return release;
}

describe("developer token management", () => {
  it("starts with token management, keeps details collapsed and opens creation on demand", async () => {
    rows = [token()];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await screen.findByRole("heading", { name: "Campus backend" });
    expect(screen.queryByRole("form", { name: "Create developer token" })).toBeNull();
    expect(
      (screen.getByText("View details for Campus backend").closest("details") as HTMLDetailsElement)
        .open,
    ).toBe(false);
    expect(requests.some((r) => r.url.includes("/deployments"))).toBe(false);
    expect(screen.getByRole("link", { name: /API reference/ }).getAttribute("href")).toBe(
      "/api/v1/openapi.json",
    );
    await user.click(screen.getByText("View details for Campus backend"));
    expect(screen.getByRole("button", { name: "Revoke token" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create token" }));
    const panel = screen.getByRole("region", { name: "Create token panel" });
    expect(document.activeElement).toBe(panel);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Create developer token" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create token" }));
  });
  it("provides a runnable environment-variable quickstart without exposing credentials", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    render(<DeveloperTokenPanel />);
    await screen.findByText("No developer tokens yet.");
    await user.click(screen.getByRole("button", { name: "Quickstart" }));
    expect(screen.queryByRole("region", { name: "Your developer tokens" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy example" }));
    const sample = copy.mock.calls[0]?.[0];
    expect(sample).toContain(String.fromCharCode(92) + "\n");
    expect(sample).toContain("Authorization: Bearer $PAIFLOW_API_TOKEN");
    expect(sample).not.toContain(SECRET);
    expect(requests.some((r) => r.url.includes("/deployments"))).toBe(false);
  });
  it("dismisses a revealed secret when navigating to Quickstart and never restores it", async () => {
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    await screen.findByTestId("developer-token-reveal");
    await user.click(screen.getByRole("button", { name: "Quickstart" }));
    expect(document.body.textContent).not.toContain(SECRET);
    await user.click(screen.getByRole("button", { name: "Tokens" }));
    expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
    expect(screen.queryByRole("form", { name: "Create developer token" })).toBeNull();
  });
  it("searches beyond the loaded page, resets pagination and preserves explicit selections", async () => {
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(screen.getByRole("button", { name: "Next deployments" }));
    await screen.findByRole("checkbox", { name: /Memberships/ });
    await user.type(screen.getByRole("searchbox"), "Memberships");
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.url === "/api/developer-tokens/deployments?limit=20&search=Memberships",
        ),
      ).toBe(true),
    );
    expect(screen.getByText("Page 1")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: /Memberships/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    await screen.findByTestId("developer-token-reveal");
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      permission: "READ_ONLY",
      deploymentIds: [A, B],
    });
  });

  it("creates only explicitly chosen deployments across pages, copies once and never recovers plaintext", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<DeveloperTokenPanel />);
    await ready();
    expect((screen.getByRole("checkbox", { name: /Donations/ }) as HTMLInputElement).checked).toBe(
      false,
    );
    await user.type(form().getByLabelText("Label (optional)"), "Campus backend");
    await user.click(form().getByRole("radio", { name: /Read and operate/ }));
    await user.selectOptions(form().getByLabelText("Expires"), "90");
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(screen.getByRole("button", { name: "Next deployments" }));
    await user.click(await screen.findByRole("checkbox", { name: /Memberships/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    const reveal = await screen.findByTestId("developer-token-reveal");
    expect(reveal.className).toContain("ph-no-capture");
    expect(document.activeElement).toBe(reveal);
    expect(reveal.textContent).toContain(SECRET);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      label: "Campus backend",
      deploymentIds: [A, B],
      permission: "READ_OPERATE",
      expiresInDays: 90,
    });
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(copy).toHaveBeenCalledWith(SECRET);
    expect(storage).not.toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Create developer token" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create token" }).matches(":disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Done, hide token" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create token" }));
    expect(document.body.textContent).not.toContain(SECRET);
    await user.click(screen.getByRole("button", { name: "Refresh token list" }));
    expect(document.body.textContent).not.toContain(SECRET);
    view.unmount();
    render(<DeveloperTokenPanel />);
    await ready();
    expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
    storage.mockRestore();
  });
  it("clears the reveal on pagehide and reports clipboard failure without leaking to errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("copy"));
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    await screen.findByTestId("developer-token-reveal");
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(screen.getByRole("alert").textContent).toContain("copy it manually");
    const { act } = await import("@testing-library/react");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
  });
  it("validates client selection and shows actionable server field errors without discarding choices", async () => {
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(form().getByRole("button", { name: "Generate token" }));
    expect(screen.getByRole("alert").textContent).toContain("Select at least one deployment");
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    mutationError = {
      error: {
        message: "Select only your confirmed active deployments",
        fields: { deploymentIds: ["One or more deployments are unavailable"] },
      },
    };
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    await screen.findByText("One or more deployments are unavailable");
    expect((screen.getByRole("checkbox", { name: /Donations/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
  });
  it("inspects fresh metadata and preserves unloaded grants when editing; permissions are immutable", async () => {
    rows = [token({ deploymentIds: [A, C] })];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(await screen.findByRole("button", { name: "Edit deployments" }));
    const editor = within(
      await screen.findByRole("form", { name: "Edit deployments for Campus backend" }),
    );
    await user.click(editor.getByText(/Review selection/));
    expect(editor.queryByRole("combobox")).toBeNull();
    expect(editor.getByText(/Permission, label and expiry are fixed/)).toBeTruthy();
    expect(editor.getByRole("button", { name: `Remove ${C}` })).toBeTruthy();
    await user.click(editor.getByRole("button", { name: "Next deployments" }));
    await user.click(await editor.findByRole("checkbox", { name: /Memberships/ }));
    await user.click(editor.getByRole("button", { name: "Save selection" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
        deploymentIds: [A, C, B],
      }),
    );
    expect(requests.some((r) => r.url.endsWith(ID) && r.method === "GET")).toBe(true);
  });
  it("can remove unavailable grants and explicitly suspend all access; failed edits stay open", async () => {
    rows = [token({ deploymentIds: [C] })];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(await screen.findByRole("button", { name: "Edit deployments" }));
    const editor = within(
      await screen.findByRole("form", { name: "Edit deployments for Campus backend" }),
    );
    await user.click(editor.getByText(/Review selection/));
    await user.click(editor.getByRole("button", { name: `Remove ${C}` }));
    expect(editor.getByText(/will have no deployment access/)).toBeTruthy();
    mutationError = { error: { message: "Token has expired. Create a replacement." } };
    await user.click(editor.getByRole("button", { name: "Save selection" }));
    await editor.findByText("Token has expired. Create a replacement.");
    mutationError = null;
    await user.click(editor.getByRole("button", { name: "Save selection" }));
    await screen.findByText("Suspended (no deployments)");
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ deploymentIds: [] });
  });
  it("confirms revocation and preserves metadata; failed revoke can retry", async () => {
    rows = [token()];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(await screen.findByRole("button", { name: "Revoke token" }));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    mutationError = { error: { message: "Try revoking again" } };
    await user.click(screen.getByRole("button", { name: "Confirm revocation" }));
    await screen.findByText("Try revoking again");
    mutationError = null;
    await user.click(screen.getByRole("button", { name: "Confirm revocation" }));
    await screen.findByText("Revoked", { selector: "span" });
    expect(screen.queryByRole("button", { name: "Edit deployments" })).toBeNull();
    expect(screen.getByText(/pfd_aaaaaaaa/)).toBeTruthy();
  });
  it("does not offer selection editing for expired or revoked tokens", async () => {
    rows = [
      token({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      token({ id: B, label: "Revoked app", revokedAt: "2020-01-01T00:00:00.000Z" }),
    ];
    render(<DeveloperTokenPanel />);
    await ready();
    await screen.findByText("Expired");
    expect(screen.queryByRole("button", { name: "Edit deployments" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Revoke token" })).toHaveLength(1);
  });
  it("handles empty and unavailable pickers and list errors with retry", async () => {
    failDeployments = true;
    failTokens = true;
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await screen.findByText(/Could not load tokens/);
    await user.click(screen.getByRole("button", { name: "Create token" }));
    await screen.findByRole("button", { name: "Retry deployments" });
    emptyDeployments = true;
    failDeployments = false;
    failTokens = false;
    await user.click(screen.getByRole("button", { name: "Retry deployments" }));
    await screen.findByText(/No eligible deployments/);
    await user.click(screen.getByRole("button", { name: "Refresh token list" }));
    await screen.findByText("No developer tokens yet.");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("searches eligible deployments and keeps selections while navigating back", async () => {
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.type(screen.getByRole("searchbox"), "missing");
    await screen.findByText(/No matching deployments/);
    await user.clear(screen.getByRole("searchbox"));
    await screen.findByRole("checkbox", { name: /Donations/ });
    await user.click(screen.getByRole("button", { name: "Next deployments" }));
    await screen.findByRole("checkbox", { name: /Memberships/ });
    await user.click(screen.getByRole("button", { name: "Previous deployments" }));
    expect(
      ((await screen.findByRole("checkbox", { name: /Donations/ })) as HTMLInputElement).checked,
    ).toBe(true);
  });
  it("loads further token pages without losing earlier metadata", async () => {
    paginateTokens = true;
    rows = [token(), token({ id: B, label: "Second app" })];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await screen.findByRole("heading", { name: "Campus backend" });
    expect(screen.queryByRole("heading", { name: "Second app" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Load more tokens" }));
    await screen.findByRole("heading", { name: "Second app" });
    expect(screen.getByRole("heading", { name: "Campus backend" })).toBeTruthy();
    expect(requests.some((r) => r.url === `/api/developer-tokens?limit=20&cursor=${ID}`)).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Load more tokens" })).toBeNull();
  });
  it("explains recovery when token creation loses its network response", async () => {
    failMutationNetwork = true;
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    await user.click(form().getByRole("button", { name: "Generate token" }));
    await screen.findByText(/revoke the uncopied token before creating another/);
    expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
    expect((screen.getByRole("checkbox", { name: /Donations/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it("blocks mutations behind an in-flight metadata refresh and recovers when it resolves", async () => {
    rows = [token()];
    const user = userEvent.setup();
    render(<DeveloperTokenPanel />);
    await ready();
    await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
    const release = deferResponse(
      (url, method) => method === "GET" && url.startsWith("/api/developer-tokens?"),
    );
    await user.click(screen.getByRole("button", { name: "Refresh token list" }));
    for (const name of ["Generate token", "Edit deployments", "Revoke token"]) {
      const control = screen.getByRole("button", { name });
      expect(control.matches(":disabled")).toBe(true);
      await user.click(control);
    }
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Revoke token" }).matches(":disabled")).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Revoke token" }));
    await user.click(screen.getByRole("button", { name: "Confirm revocation" }));
    await screen.findByText("Revoked", { selector: "span" });
    expect(screen.queryByText("Active", { selector: "span" })).toBeNull();
  });
  it.each(["POST", "PATCH", "DELETE"])(
    "blocks stale list reads while %s is pending and releases controls after completion",
    async (method) => {
      rows = method === "POST" ? [] : [token()];
      const user = userEvent.setup();
      render(<DeveloperTokenPanel />);
      await ready();
      const release = deferResponse((_url, requestMethod) => requestMethod === method);
      if (method === "POST") {
        await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
        await user.click(form().getByRole("button", { name: "Generate token" }));
      } else if (method === "PATCH") {
        await user.click(screen.getByRole("button", { name: "Edit deployments" }));
        const editor = within(
          await screen.findByRole("form", { name: "Edit deployments for Campus backend" }),
        );
        await user.click(editor.getByText(/Review selection/));
        await user.click(editor.getByRole("button", { name: `Remove ${A}` }));
        await user.click(editor.getByRole("button", { name: "Save selection" }));
      } else {
        await user.click(screen.getByRole("button", { name: "Revoke token" }));
        await user.click(screen.getByRole("button", { name: "Confirm revocation" }));
      }
      await waitFor(() => expect(requests.some((r) => r.method === method)).toBe(true));
      const before = requests.filter((r) => r.url.startsWith("/api/developer-tokens?")).length;
      const refresh = screen.getByRole("button", { name: "Refresh token list" });
      expect(refresh.matches(":disabled")).toBe(true);
      await user.click(refresh);
      expect(requests.filter((r) => r.url.startsWith("/api/developer-tokens?")).length).toBe(
        before,
      );
      await act(async () => {
        release();
      });
      const state =
        method === "POST"
          ? "Active"
          : method === "PATCH"
            ? "Suspended (no deployments)"
            : "Revoked";
      await screen.findByText(state, { selector: "span" });
      await waitFor(() => expect(refresh.matches(":disabled")).toBe(false));
      await user.click(refresh);
      await waitFor(() =>
        expect(requests.filter((r) => r.url.startsWith("/api/developer-tokens?")).length).toBe(
          before + 1,
        ),
      );
      await screen.findByText(state, { selector: "span" });
    },
  );
  it.each(["pagehide", "visibilitychange"])(
    "does not reveal a late create response after %s dismisses the secret",
    async (event) => {
      const user = userEvent.setup();
      render(<DeveloperTokenPanel />);
      await ready();
      const release = deferResponse((_url, method) => method === "POST");
      await user.click(screen.getByRole("checkbox", { name: /Donations/ }));
      await user.click(form().getByRole("button", { name: "Generate token" }));
      await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
      if (event === "visibilitychange") {
        const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        act(() => {
          document.dispatchEvent(new Event(event));
        });
        visibility.mockReturnValue("visible");
        act(() => {
          document.dispatchEvent(new Event(event));
        });
      } else
        act(() => {
          window.dispatchEvent(new Event(event));
        });
      await act(async () => {
        release();
      });
      await screen.findByText(/Token created after the secret reveal was dismissed/);
      expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
      expect(document.body.textContent).not.toContain(SECRET);
      await screen.findByText("Active", { selector: "span" });
      expect(screen.getByRole("button", { name: "Revoke token" }).matches(":disabled")).toBe(false);
      await user.click(screen.getByRole("button", { name: "Refresh token list" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Refresh token list" }).matches(":disabled"),
        ).toBe(false),
      );
      expect(screen.queryByTestId("developer-token-reveal")).toBeNull();
    },
  );
  it("has labelled keyboard controls without automated accessibility violations", async () => {
    rows = [token()];
    const user = userEvent.setup();
    const { container } = render(<DeveloperTokenPanel />);
    await ready();
    await user.click(await screen.findByRole("button", { name: "Edit deployments" }));
    await screen.findByRole("form", { name: "Edit deployments for Campus backend" });
    expect(
      (
        await axe.run(container, { rules: { "color-contrast": { enabled: false } } })
      ).violations.map((v) => v.id),
    ).toEqual([]);
    cleanup();
  });
});
