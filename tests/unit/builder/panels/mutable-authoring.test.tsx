import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrKey } from "@stellar/stellar-sdk";
import { FlowGraphSchema, FlowPatchSchema, type FlowGraph } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { updateBuilderPolicy } from "@/components/builder/field-policy.utils";
import { editBuilderNodes } from "@/components/builder/graph-state.utils";
import { PayRecipientEditor } from "@/components/builder/panels/pay-recipient-editor";
import { SplitRecipientsEditor } from "@/components/builder/panels/split-recipients-editor";
import type { PayFieldPolicy } from "@/lib/flows/field-policies";
const address = (i: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, i));
function graph(): FlowGraph {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            {
              rowId: "platform",
              address: address(1),
              label: "Platform",
              mode: "percentage",
              bps: 1500,
            },
          ],
        },
      },
    ],
    edges: [{ id: "e", source: "root", target: "split" }],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: "percentage",
          rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
          additionalRecipients: "constant",
        },
      ],
    },
  });
}
function Split({ spy, initial = graph() }: { spy: (g: FlowGraph) => void; initial?: FlowGraph }) {
  const [value, setValue] = useState(initial),
    node = value.nodes[1],
    policy = value.fieldPolicies?.nodes[0];
  if (node?.type !== "split" || policy?.kind !== "split") throw new Error();
  const update = (next: Pick<FlowGraph, "nodes" | "fieldPolicies">) => {
    const g = FlowPatchSchema.parse({ graph: { ...value, ...next } }).graph!;
    setValue(g);
    spy(g);
  };
  return (
    <SplitRecipientsEditor
      node={node}
      trigger={value.nodes[0]}
      sourceAmount={undefined}
      addressBook={[]}
      sandbox
      policy={policy}
      allocationMode={policy.allocationMode}
      onPolicyChange={(p) => update(updateBuilderPolicy(value, p))}
      onChange={(n) =>
        update(
          editBuilderNodes(
            value,
            value.nodes.map((old) => (old.id === n.id ? n : old)),
          ),
        )
      }
    />
  );
}
function Pay({ full = false, issue }: { full?: boolean; issue?: string }) {
  const [policy, setPolicy] = useState<PayFieldPolicy>({
    kind: "pay",
    nodeId: "pay",
    recipient: "constant",
    payoutValue: "constant",
  });
  return (
    <PayRecipientEditor
      recipient={address(1)}
      policy={policy}
      fullAmount={full}
      executionIssue={issue}
      onRecipientChange={() => {}}
      onPolicyChange={setPolicy}
      addressBook={[]}
    />
  );
}
describe("mutable initial configuration authoring", () => {
  it("declares Pay recipient and stored payout separately without exposing execution payout values", async () => {
    const user = userEvent.setup();
    render(<Pay />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Recipient source" }), "mutable");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Payout value source" }),
      "mutable",
    );
    expect(
      (screen.getByRole("combobox", { name: "Payout value source" }) as HTMLSelectElement).value,
    ).toBe("mutable");
    const options = Array.from(
      (screen.getByRole("combobox", { name: "Payout value source" }) as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual(["constant", "mutable"]);
    expect(screen.getByText(/Set complete initial values now/)).toBeTruthy();
  });
  it("keeps full Pay payout constant and disables stored declarations on unsupported paths", () => {
    const view = render(<Pay full />);
    expect(screen.queryByRole("combobox", { name: "Payout value source" })).toBeNull();
    expect(screen.getByText(/full amount is a constant rule/)).toBeTruthy();
    view.unmount();
    render(<Pay issue="Scheduled paths do not support these modes" />);
    expect(screen.queryByRole("option", { name: "Admin can update stored value" })).toBeNull();
  });
  it("stages incomplete stored rows locally, then applies valid 15% plus 85% terms without losing constants", async () => {
    const user = userEvent.setup(),
      spy = vi.fn<(g: FlowGraph) => void>();
    render(<Split spy={spy} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Additional recipients" }),
      "mutable",
    );
    const before = spy.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Add stored recipient" }));
    expect(spy.mock.calls.length).toBe(before);
    await user.click(screen.getByRole("button", { name: "Apply stored roster to draft" }));
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBe(before);
    fireEvent.change(screen.getByRole("textbox", { name: "Stored recipient 1" }), {
      target: { value: address(2) },
    });
    const share = screen.getByRole("textbox", { name: "Stored share 1" });
    await user.clear(share);
    await user.type(share, "85");
    await user.tab();
    expect(spy.mock.calls.length).toBe(before);
    await user.click(screen.getByRole("button", { name: "Apply stored roster to draft" }));
    const saved = spy.mock.lastCall![0],
      node = saved.nodes[1];
    if (node?.type !== "split") throw new Error();
    expect(node.config.recipients).toMatchObject([
      { rowId: "platform", address: address(1), bps: 1500 },
    ]);
    expect(node.config.additionalRecipients).toMatchObject([
      { recipient: address(2), allocation: { kind: "percentage", bps: 8500 } },
    ]);
    expect(validateFlow(saved).ok).toBe(true);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Additional recipients" }),
      "constant",
    );
    const cleared = spy.mock.lastCall![0].nodes[1];
    expect(cleared?.type === "split" && cleared.config.additionalRecipients).toBeUndefined();
  });
  it("refuses appended duplicates without overwriting the saved roster", async () => {
    const user = userEvent.setup(),
      spy = vi.fn<(g: FlowGraph) => void>();
    const initial = graph();
    const policy = initial.fieldPolicies!.nodes[0]!;
    if (policy.kind !== "split") throw new Error();
    policy.additionalRecipients = "mutable";
    render(<Split spy={spy} initial={initial} />);
    await user.click(screen.getByRole("button", { name: "Add stored recipient" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Stored recipient 1" }), {
      target: { value: address(1) },
    });
    const share = screen.getByRole("textbox", { name: "Stored share 1" });
    await user.clear(share);
    await user.type(share, "85");
    await user.tab();
    await user.click(screen.getByRole("button", { name: "Apply stored roster to draft" }));
    expect(screen.getByText(/must be unique/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
  it("prevents mixed mutable and per-payment allocation authorities", async () => {
    const user = userEvent.setup(),
      initial = graph(),
      spy = vi.fn<(g: FlowGraph) => void>();
    const p = initial.fieldPolicies!.nodes[0]!;
    if (p.kind !== "split") throw new Error();
    p.rows[0]!.allocation = "execution";
    render(<Split spy={spy} initial={initial} />);
    const select = screen.getByRole("combobox", {
      name: "Additional recipients",
    }) as HTMLSelectElement;
    expect(Array.from(select.options).find((o) => o.value === "mutable")?.disabled).toBe(true);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Allocation source for Platform" }),
      "constant",
    );
    await user.selectOptions(select, "mutable");
    expect(spy.mock.lastCall![0].fieldPolicies?.nodes[0]).toMatchObject({
      additionalRecipients: "mutable",
      rows: [{ rowId: "platform", allocation: "constant" }],
    });
  });
});
