import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { FlowGraphSchema, FlowPatchSchema, type FlowGraph } from "@/lib/flows/schema";
import { builderNodePolicy, updateBuilderPolicy } from "@/components/builder/field-policy.utils";
import { editBuilderNodes, type BuilderDraft } from "@/components/builder/graph-state.utils";
import { FieldPolicyNotice } from "@/components/builder/field-policy-notice";
import { FieldModeSelect } from "@/components/builder/inputs/field-mode-select";
import { PayRecipientEditor } from "@/components/builder/panels/pay-recipient-editor";
import { SplitRecipientsEditor } from "@/components/builder/panels/split-recipients-editor";

const ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
function initial(kind: "pay" | "split") {
  return FlowGraphSchema.parse({
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      kind === "pay"
        ? {
            id: "action",
            type: "pay",
            config: { asset: { kind: "native" }, recipient: ADDRESS, fullAmount: true },
          }
        : {
            id: "action",
            type: "split",
            config: {
              asset: { kind: "native" },
              recipients: [
                { address: ADDRESS, label: "Platform", mode: "percentage", bps: 1000 },
                { address: "", label: "Worker", mode: "percentage", bps: 9000 },
              ],
            },
          },
    ],
    edges: [{ id: "edge", source: "receive", target: "action" }],
  });
}
function Controls({ kind, spy }: { kind: "pay" | "split"; spy: (graph: FlowGraph) => void }) {
  const [draft, setDraft] = useState<BuilderDraft>(() => initial(kind));
  const node = draft.nodes[1]!;
  const policy = builderNodePolicy(node, draft.fieldPolicies)!;
  function save(next: BuilderDraft) {
    const graph = FlowPatchSchema.parse({ graph: { ...next, edges: initial(kind).edges } }).graph!;
    spy(graph);
    setDraft(next);
  }
  return node.type === "pay" && policy.kind === "pay" ? (
    <PayRecipientEditor
      recipient={node.config.recipient}
      policy={policy}
      addressBook={[]}
      onPolicyChange={(next) => save(updateBuilderPolicy(draft, next))}
      onRecipientChange={(recipient) =>
        save(
          editBuilderNodes(draft, [
            draft.nodes[0]!,
            { ...node, config: { ...node.config, recipient } },
          ]),
        )
      }
    />
  ) : node.type === "split" && policy.kind === "split" ? (
    <SplitRecipientsEditor
      node={node}
      trigger={draft.nodes[0]}
      sourceAmount={undefined}
      addressBook={[]}
      sandbox
      policy={policy}
      allocationMode={draft.fieldPolicies ? policy.allocationMode : undefined}
      onPolicyChange={(next) => save(updateBuilderPolicy(draft, next))}
      onChange={(next) => save(editBuilderNodes(draft, [draft.nodes[0]!, next]))}
    />
  ) : null;
}

describe("execution declaration controls", () => {
  it("makes the Pay recipient required at payment time, without retaining an apparent fallback field", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    const { container } = render(<Controls kind="pay" spy={spy} />);
    const select = screen.getByRole("combobox", { name: "Recipient source" });
    expect((select as HTMLSelectElement).value).toBe("constant");
    await user.selectOptions(select, "execution");
    expect(screen.queryByRole("combobox", { name: "Recipient (G… or PENDING:)" })).toBeNull();
    expect(screen.getByText(/No saved address is used/)).toBeTruthy();
    expect(spy.mock.lastCall![0].fieldPolicies?.nodes[0]).toMatchObject({
      recipient: "execution",
      payoutValue: "constant",
    });
    expect(screen.queryByRole("option", { name: /mutable|stored update/i })).toBeNull();
    expect(
      (await axe.run(container, { rules: { region: { enabled: false } } })).violations,
    ).toEqual([]);
    await user.selectOptions(select, "constant");
    expect(
      (screen.getByRole("combobox", { name: "Recipient (G… or PENDING:)" }) as HTMLInputElement)
        .value,
    ).toBe(ADDRESS);
    expect(spy.mock.lastCall![0].fieldPolicies?.nodes[0]).toMatchObject({ recipient: "constant" });
  });

  it("keeps the platform row constant while declaring worker and extra-roster inputs", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    const { container } = render(<Controls kind="split" spy={spy} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Recipient source for Worker" }),
      "execution",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Allocation source for Worker" }),
      "execution",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Additional recipients" }),
      "execution",
    );
    const saved = spy.mock.lastCall![0];
    expect(saved.fieldPolicies?.nodes[0]).toMatchObject({
      additionalRecipients: "execution",
      rows: [
        { rowId: "row-1", recipient: "constant", allocation: "constant" },
        { rowId: "row-2", recipient: "execution", allocation: "execution" },
      ],
    });
    const split = saved.nodes[1]!;
    expect(split.type === "split" && split.config.recipients[0]).toMatchObject({
      address: ADDRESS,
      bps: 1000,
    });
    expect(screen.getByRole("combobox", { name: "Wallet address for recipient 1" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Wallet address for recipient 2" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Share for Worker" })).toBeNull();
    expect(
      screen.getByText(/Constant shares plus payer-supplied shares must total exactly 100%/),
    ).toBeTruthy();
    expect(
      (await axe.run(container, { rules: { region: { enabled: false } } })).violations,
    ).toEqual([]);
  });

  it("preserves constant rows when changing distribution mode and supports a fixed variable-only roster", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    render(<Controls kind="split" spy={spy} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Additional recipients" }),
      "execution",
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Distribution mode" }), "fixed");
    expect(screen.getByText(/No excess or partial payment is retained/)).toBeTruthy();
    let policy = spy.mock.lastCall![0].fieldPolicies?.nodes[0];
    expect(policy).toMatchObject({
      allocationMode: "fixed",
      rows: [
        { rowId: "row-1", recipient: "constant", allocation: "constant" },
        { rowId: "row-2", recipient: "constant", allocation: "constant" },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Remove recipient 2" }));
    await user.click(screen.getByRole("button", { name: "Remove recipient 1" }));
    policy = spy.mock.lastCall![0].fieldPolicies?.nodes[0];
    expect(policy).toMatchObject({
      allocationMode: "fixed",
      rows: [],
      additionalRecipients: "execution",
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Distribution mode" }),
      "percentage",
    );
    expect(spy.mock.lastCall![0].fieldPolicies?.nodes[0]).toMatchObject({
      allocationMode: "percentage",
      rows: [],
    });
  });

  it("keeps incompatible execution options disabled and explains environment deployment unavailability", () => {
    render(
      <>
        <FieldModeSelect
          label="Recipient source"
          value="constant"
          onChange={vi.fn()}
          executionIssue="Use one On Receive path."
        />
        <FieldPolicyNotice available={false} />
      </>,
    );
    expect(
      (screen.getByRole("option", { name: "Payer supplies each payment" }) as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Use one On Receive path.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("drafts can be saved");
    expect(screen.getByRole("status").textContent).toContain("not ready to deploy");
    expect(screen.queryByRole("option", { name: /mutable/i })).toBeNull();
  });
});
