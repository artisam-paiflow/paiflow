import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DevValuesPanel from "@/components/deploy/dev-values-panel";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success } }));
const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const other = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U";
const pay: Extract<FlowNode, { type: "pay" }> = {
  id: "pay-1",
  type: "pay",
  config: {
    recipient: "PENDING:team",
    asset: { kind: "native" },
    mode: "fixed",
    fullAmount: false,
    fillValueViaApi: true,
  },
};
const split: Extract<FlowNode, { type: "split" }> = {
  id: "split-1",
  type: "split",
  config: {
    asset: { kind: "native" },
    recipients: [{ address: "PENDING:team", mode: "fixed", amountStroops: "0" }],
  },
};
const fetchMock = vi.fn();
let configured: boolean | null;
let response: unknown;
let ok: boolean;
let source: FlowNode;
function mount(overrides: Partial<React.ComponentProps<typeof DevValuesPanel>> = {}) {
  const graph: FlowGraph = { nodes: [source], edges: [], devMode: true };
  return render(
    <DevValuesPanel
      deploymentId="deployment-1"
      network="testnet"
      status="CONFIRMED"
      canEdit
      graph={graph}
      {...overrides}
    />,
  );
}
function posts() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}
async function fillPay() {
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Save Pay" });
  await user.type(screen.getByRole("combobox", { name: "Recipient" }), address);
  await user.type(screen.getByRole("textbox", { name: "Amount" }), "1.5");
  return user;
}
beforeEach(() => {
  configured = false;
  source = pay;
  ok = true;
  response = { data: { warnings: [] } };
  success.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok, json: async () => response };
    return {
      ok: true,
      json: async () => ({
        data: {
          nodes: [
            {
              nodeId: source.id,
              templateKind: source.type === "pay" ? "PAYER_DEV" : "SPLITTER_DEV",
              configured,
            },
          ],
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Dev values", () => {
  it.each([
    { graph: { nodes: [], edges: [], devMode: false } },
    { status: "PENDING" },
    { status: "FAILED" },
    { canEdit: false },
    { network: null },
  ])("is hidden without an eligible owner deployment: %j", (overrides) => {
    mount(overrides);
    expect(screen.queryByTestId("dev-values-panel")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [false, "Unconfigured"],
    [true, "Configured"],
    [null, "Configuration status unavailable"],
  ] as const)("shows status %s", async (value, label) => {
    configured = value;
    mount();
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByTestId("network-chip").textContent).toBe("TESTNET");
  });
  it("saves decimal Pay amounts as stroops strings using a session, toasts and refreshes", async () => {
    mount({ network: "mainnet" });
    const user = await fillPay();
    configured = true;
    await user.click(screen.getByRole("button", { name: "Save Pay" }));
    await screen.findByText("Configured");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[0]).toBe("/api/deployments/deployment-1/dev-payer");
    expect(JSON.parse(posts()[0]?.[1].body)).toEqual({
      nodeId: "pay-1",
      recipient: address,
      mode: "fixed",
      amountStroops: "15000000",
    });
    expect(posts()[0]?.[1].headers).toEqual({ "content-type": "application/json" });
    expect(success).toHaveBeenCalledWith("Dev values saved");
    expect(screen.getByTestId("network-chip").textContent).toBe("MAINNET");
  });
  it("saves Pay shares and does not send a fixed amount", async () => {
    source = { ...pay, config: { ...pay.config, mode: "percentage", percentage: 0 } };
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save Pay" });
    await user.type(screen.getByRole("combobox", { name: "Recipient" }), address);
    const share = screen.getByRole("textbox", { name: "Share" });
    await user.clear(share);
    await user.type(share, "12.5");
    await user.click(screen.getByRole("button", { name: "Save Pay" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]?.[1].body)).toEqual({
      nodeId: "pay-1",
      recipient: address,
      mode: "percentage",
      percentage: 12.5,
    });
  });
  it("configures full-amount Pay with a 100% share", async () => {
    source = { ...pay, config: { ...pay.config, fullAmount: true } };
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save Pay" });
    await user.type(screen.getByRole("combobox", { name: "Recipient" }), address);
    expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save Pay" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]?.[1].body)).toEqual({
      nodeId: "pay-1",
      recipient: address,
      mode: "percentage",
      percentage: 100,
    });
  });
  it.each(["fixed", "percentage"] as const)("saves Split %s recipients", async (mode) => {
    source = {
      ...split,
      config: {
        ...split.config,
        recipients: [
          {
            address: "PENDING:team",
            ...(mode === "fixed"
              ? { mode: "fixed" as const, amountStroops: "0" }
              : { mode: "percentage" as const, bps: 10000 }),
          },
        ],
      },
    };
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save Split" });
    await user.type(screen.getByRole("combobox", { name: "Recipient 1" }), address);
    if (mode === "fixed") {
      const amount = screen.getByRole("textbox", { name: "Amount 1" });
      await user.clear(amount);
      await user.type(amount, "0.1234567");
    }
    await user.click(screen.getByRole("button", { name: "Save Split" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]?.[0]).toBe("/api/deployments/deployment-1/dev-splitter");
    expect(JSON.parse(posts()[0]?.[1].body)).toEqual({
      nodeId: "split-1",
      recipients: [
        {
          address,
          mode,
          payoutMode: "crypto",
          ...(mode === "fixed" ? { amountStroops: "1234567" } : { bps: 10000 }),
        },
      ],
    });
  });
  it.each(["MISSING_ACCOUNT", "MISSING_TRUSTLINE"])(
    "shows %s beside its recipient after saving",
    async (code) => {
      response = {
        data: {
          warnings: [
            {
              code,
              recipient: address,
              nodeId: "pay-1",
              message: "Recipient cannot receive USDC yet",
            },
          ],
        },
      };
      mount();
      const user = await fillPay();
      await user.click(screen.getByRole("button", { name: "Save Pay" }));
      expect(await screen.findByText("Recipient cannot receive USDC yet")).toBeTruthy();
      expect(success).toHaveBeenCalled();
    },
  );
  it("renders server field errors and an inline failure", async () => {
    ok = false;
    response = {
      error: {
        code: "VALIDATION",
        message: "Invalid input",
        fields: { recipient: ["Recipient refused"] },
      },
    };
    mount();
    const user = await fillPay();
    await user.click(screen.getByRole("button", { name: "Save Pay" }));
    expect(await screen.findByText("Recipient refused")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Recipient" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(success).not.toHaveBeenCalled();
  });
  it("shows nested Split field errors", async () => {
    source = {
      ...split,
      config: {
        ...split.config,
        recipients: [{ address, mode: "fixed", amountStroops: "10000000" }],
      },
    };
    ok = false;
    response = {
      error: {
        code: "VALIDATION",
        fields: { "recipients.0.address": ["Split recipient refused"] },
      },
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save Split" }));
    expect(await screen.findByText("Split recipient refused")).toBeTruthy();
  });
  it("refuses half-typed addresses before posting", async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save Pay" });
    await user.type(screen.getByRole("combobox", { name: "Recipient" }), "GBPARTIAL");
    await user.type(screen.getByRole("textbox", { name: "Amount" }), "1.5");
    await user.click(screen.getByRole("button", { name: "Save Pay" }));
    expect(await screen.findByText("Invalid Stellar address")).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });
  it("prevents a Split whose shares do not total 100%", async () => {
    source = {
      ...split,
      config: {
        ...split.config,
        recipients: [
          { address, mode: "percentage", bps: 5000 },
          { address: other, mode: "percentage", bps: 4000 },
        ],
      },
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save Split" }));
    expect(await screen.findByText(/Use distinct recipients/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });
  it("lets an empty Split choose fixed amounts, add and remove recipients", async () => {
    source = { ...split, config: { ...split.config, recipients: [] } };
    mount();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Save Split" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Split mode" }), "fixed");
    await user.type(screen.getByRole("combobox", { name: "Recipient 1" }), address);
    await user.type(screen.getByRole("textbox", { name: "Amount 1" }), "1.5");
    await user.click(screen.getByRole("button", { name: "Add recipient" }));
    await user.type(screen.getByRole("combobox", { name: "Recipient 2" }), other);
    await user.type(screen.getByRole("textbox", { name: "Amount 2" }), "2.5");
    await user.click(screen.getByRole("button", { name: "Remove recipient 1" }));
    await user.click(screen.getByRole("button", { name: "Save Split" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0]?.[1].body)).toEqual({
      nodeId: "split-1",
      recipients: [
        { address: other, mode: "fixed", amountStroops: "25000000", payoutMode: "crypto" },
      ],
    });
  });
  it("renders Split warnings beside the matching recipient", async () => {
    source = {
      ...split,
      config: {
        ...split.config,
        recipients: [
          { address, mode: "fixed", amountStroops: "10000000" },
          { address: other, mode: "fixed", amountStroops: "20000000" },
        ],
      },
    };
    response = {
      data: {
        warnings: [
          {
            code: "MISSING_ACCOUNT",
            recipient: other,
            nodeId: "split-1",
            message: "Second recipient needs funding",
          },
        ],
      },
    };
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save Split" }));
    const warning = await screen.findByText("Second recipient needs funding");
    expect(
      warning.parentElement?.querySelector('input[role="combobox"]')?.getAttribute("value"),
    ).toBe(other);
  });
});
