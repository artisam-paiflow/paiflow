import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TemplateManager from "@/components/flow-templates/template-manager";
import { graph, ownerId, templateId, version, versionId } from "./ui-fixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/components/flow-templates/instance-form", () => ({
  default: ({ version: v }: { version: { id: string } }) => (
    <div>Instance pinned version {v.id}</div>
  ),
}));
let bodies: { url: string; body: unknown }[];
let conflict: boolean;
let published: number;
const draft = () => ({
  id: templateId,
  name: "Private agreement",
  description: null,
  draftRevision: 1,
  retiredAt: null,
  draft: version.definition,
});
beforeEach(() => {
  vi.clearAllMocks();
  bodies = [];
  conflict = false;
  published = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push({ url, body: JSON.parse(String(init.body)) });
      if (init?.method === "PATCH" && conflict)
        return Response.json(
          {
            error: {
              code: "CONFLICT",
              message: "Draft changed; reload before editing or publishing",
            },
          },
          { status: 409 },
        );
      if (url.startsWith("/api/flows/"))
        return Response.json({ data: { name: "Saved flow", graph } });
      if (url.endsWith("/versions") && init?.method === "POST") {
        published++;
        return Response.json({ data: { ...version, version: published + 1 } });
      }
      if (url.includes("/versions?"))
        return Response.json({
          data: {
            items: [
              version,
              { ...version, id: "66666666-6666-4666-8666-666666666666", version: 2 },
            ],
            nextCursor: null,
          },
        });
      if (url.endsWith(`/versions/${versionId}`)) return Response.json({ data: version });
      if (url.endsWith("/versions/66666666-6666-4666-8666-666666666666"))
        return Response.json({
          data: { ...version, id: "66666666-6666-4666-8666-666666666666", version: 2 },
        });
      if (url.endsWith(`/${templateId}`) || init?.method === "POST")
        return Response.json({ data: draft() });
      return Response.json({ data: { items: [draft()], nextCursor: null } });
    }),
  );
});
function show() {
  return render(<TemplateManager ownerId={ownerId} username="Developer" network="testnet" />);
}
afterEach(() => vi.unstubAllGlobals());
async function click(name: string) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  fireEvent.click(button);
}
describe("private template management", () => {
  it("copies an owned saved exemplar and declares a finite typed leaf without implicit defaults", async () => {
    show();
    await screen.findByRole("button", { name: "Private agreement" });
    fireEvent.change(screen.getByRole("textbox", { name: "Saved flow ID" }), {
      target: { value: ownerId },
    });
    await click("Copy saved graph");
    await screen.findByText("Exemplar terms and runtime modes");
    fireEvent.change(screen.getByRole("combobox", { name: "Configured field" }), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Input ID" }), {
      target: { value: "recipient" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Input label" }), {
      target: { value: "Customer wallet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add creation input" }));
    expect(screen.getByText(/Required, no default/)).toBeTruthy();
    await click("Save private draft");
    await screen.findByText(/draft revision 1/);
    const sent = bodies.find((r) => r.url === "/api/flow-templates")!.body as {
      definition: typeof version.definition;
    };
    expect(sent.definition.inputs).toEqual(version.definition.inputs);
    expect(sent.definition.graph).toEqual(graph);
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/prepare"), expect.anything());
  });
  it("selects exact immutable versions from API and never uses latest implicitly", async () => {
    show();
    await click("Private agreement");
    await click("Version 1 · TESTNET");
    expect(await screen.findByText(`Instance pinned version ${versionId}`)).toBeTruthy();
    await click("Version 2 · TESTNET");
    expect(
      await screen.findByText("Instance pinned version 66666666-6666-4666-8666-666666666666"),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/flow-templates/${templateId}/versions/66666666-6666-4666-8666-666666666666`,
      undefined,
    );
  });
  it("refuses publication of dirty draft and keeps revision-conflicted edits until explicit reload", async () => {
    show();
    await click("Private agreement");
    await screen.findByRole("button", { name: "Publish immutable version" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reload saved draft" }).matches(":disabled")).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Template name" }), {
      target: { value: "New terms" },
    });
    expect(
      screen.getByRole("button", { name: "Publish immutable version" }).matches(":disabled"),
    ).toBe(true);
    conflict = true;
    await click("Save private draft");
    await screen.findByText("Draft changed; reload before editing or publishing");
    expect((screen.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value).toBe(
      "New terms",
    );
    expect(published).toBe(0);
    conflict = false;
    await click("Reload saved draft");
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Template name" }) as HTMLInputElement).value,
      ).toBe("Private agreement"),
    );
    await click("Publish immutable version");
    await waitFor(() => expect(published).toBe(1));
    expect(bodies.find((r) => r.url.endsWith("/versions"))?.body).toEqual({ expectedRevision: 1 });
  });
});
