import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FlowGraphSchema, FlowPatchSchema, type FlowGraph } from "@/lib/flows/schema";
import { editBuilderNodes, type BuilderDraft } from "@/components/builder/graph-state.utils";
import { SplitRecipientsEditor } from "@/components/builder/panels/split-recipients-editor";

function fixture() {
  return FlowGraphSchema.parse({
    nodes: [
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            {
              rowId: "platform",
              address: "PENDING:platform",
              label: "Platform",
              email: "platform@example.com",
              mode: "percentage",
              bps: 1000,
            },
            {
              rowId: "worker",
              address: "PENDING:worker",
              label: "Worker",
              mode: "percentage",
              bps: 9000,
            },
          ],
        },
      },
    ],
    edges: [],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: "percentage",
          rows: [
            { rowId: "platform" },
            { rowId: "worker", recipient: "execution", allocation: "execution" },
          ],
          additionalRecipients: "execution",
        },
      ],
    },
  });
}
function Editor({
  spy,
  initial = fixture(),
}: {
  spy: (graph: FlowGraph) => void;
  initial?: FlowGraph;
}) {
  const [draft, setDraft] = useState<BuilderDraft>(initial);
  const node = draft.nodes[0];
  const policy = draft.fieldPolicies?.nodes[0];
  if (node?.type !== "split" || policy?.kind !== "split") throw new Error("Invalid fixture");
  return (
    <SplitRecipientsEditor
      node={node}
      trigger={undefined}
      sourceAmount={undefined}
      addressBook={[]}
      sandbox
      allocationMode={policy.allocationMode}
      onChange={(updated) => {
        const next = editBuilderNodes(draft, [updated]);
        const graph = FlowPatchSchema.parse({ graph: { ...next, edges: [] } }).graph!;
        spy(graph);
        setDraft(next);
      }}
    />
  );
}
function splitPolicy(graph: FlowGraph) {
  const policy = graph.fieldPolicies?.nodes[0];
  if (policy?.kind !== "split") throw new Error("Missing split policy");
  return policy;
}
function splitRows(graph: FlowGraph) {
  const node = graph.nodes[0];
  if (node?.type !== "split") throw new Error("Missing split");
  return node.config.recipients;
}

describe("policy-aware Split draft authoring", () => {
  it("preserves row IDs, field modes and personal metadata through mode switches and deletion", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    render(<Editor spy={spy} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Distribution mode" }), "fixed");
    const fixed = spy.mock.lastCall![0];
    expect(splitRows(fixed).map((r) => r.rowId)).toEqual(["platform", "worker"]);
    expect(splitRows(fixed)[0]?.email).toBe("platform@example.com");
    expect(splitPolicy(fixed)).toMatchObject({
      allocationMode: "fixed",
      rows: [
        { rowId: "platform", recipient: "constant", allocation: "constant" },
        { rowId: "worker", recipient: "execution", allocation: "execution" },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Remove recipient 1" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Distribution mode" }),
      "percentage",
    );
    const remaining = spy.mock.lastCall![0];
    expect(splitRows(remaining)).toMatchObject([
      { rowId: "worker", mode: "percentage", bps: 9000 },
    ]);
    expect(splitPolicy(remaining)).toMatchObject({
      allocationMode: "percentage",
      rows: [{ rowId: "worker", recipient: "execution", allocation: "execution" }],
    });
  });
  it("adds constant configured rows without erasing surviving execution authority", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    render(<Editor spy={spy} />);
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const added = spy.mock.lastCall![0];
    expect(splitPolicy(added).rows).toEqual([
      { rowId: "platform", recipient: "constant", allocation: "constant" },
      { rowId: "worker", recipient: "execution", allocation: "execution" },
      { rowId: expect.any(String), recipient: "constant", allocation: "constant" },
    ]);
    expect(splitRows(added)[2]?.rowId).toBe(splitPolicy(added).rows[2]?.rowId);
    await user.click(screen.getByRole("button", { name: "Remove recipient 2" }));
    const removed = spy.mock.lastCall![0];
    expect(splitPolicy(removed).rows.map((r) => r.rowId)).toEqual([
      "platform",
      splitRows(added)[2]?.rowId,
    ]);
    expect(splitPolicy(removed).additionalRecipients).toBe("execution");
  });
  it("retains an empty draft's allocation mode and uses it when adding the next row", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(graph: FlowGraph) => void>();
    render(<Editor spy={spy} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Distribution mode" }), "fixed");
    await user.click(screen.getByRole("button", { name: "Remove recipient 2" }));
    await user.click(screen.getByRole("button", { name: "Remove recipient 1" }));
    const select = screen.getByRole("combobox", { name: "Distribution mode" }) as HTMLSelectElement;
    expect(select.value).toBe("fixed");
    expect(select.disabled).toBe(true);
    expect(splitPolicy(spy.mock.lastCall![0])).toMatchObject({ allocationMode: "fixed", rows: [] });
    await user.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const next = spy.mock.lastCall![0];
    expect(splitRows(next)).toMatchObject([{ mode: "fixed", rowId: expect.any(String) }]);
    expect(splitPolicy(next).rows).toEqual([
      { rowId: splitRows(next)[0]?.rowId, recipient: "constant", allocation: "constant" },
    ]);
    expect(select.disabled).toBe(false);
  });
});
