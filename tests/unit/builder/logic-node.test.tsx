/**
 * The condition node's source handles (#720): an amount condition shows a True
 * and a False output, other kinds one, and each handle id is the branch an
 * edge drawn from it is saved with. Rendered inside a real <ReactFlow>, since
 * a Handle outside one has no node id and renders nothing.
 */
import { render } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import { beforeAll, describe, expect, it } from "vitest";
import LogicNode from "@/components/nodes/logic-node";
import type { FlowNode } from "@/lib/flows/schema";

beforeAll(() => {
  // jsdom has no ResizeObserver; React Flow measures nodes with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const PAY: FlowNode = {
  id: "p",
  type: "pay",
  config: {
    asset: { kind: "native" },
    recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    fullAmount: true,
  },
};

function renderCondition(
  config: Extract<FlowNode, { type: "condition" }>["config"],
  edges: Edge[] = [],
) {
  const node: FlowNode = { id: "c", type: "condition", config };
  const nodes: Node[] = [
    { id: "c", type: "logic", position: { x: 0, y: 0 }, data: { node, label: "condition" } },
    { id: "p", type: "logic", position: { x: 0, y: 200 }, data: { node: PAY, label: "pay" } },
  ];
  return render(
    <ReactFlowProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={{ logic: LogicNode }} />
      </div>
    </ReactFlowProvider>,
  );
}

function sourceHandleIds(container: HTMLElement): (string | null)[] {
  return [
    ...container.querySelectorAll('.react-flow__node[data-id="c"] .react-flow__handle.source'),
  ].map((h) => h.getAttribute("data-handleid"));
}

describe("LogicNode outputs", () => {
  it("gives an amount condition a True and a False handle, labelled", () => {
    const { container } = renderCondition({ kind: "amount_gt", amountStroops: "50000000" });
    expect(sourceHandleIds(container)).toEqual(["true", "false"]);
    const node = container.querySelector('.react-flow__node[data-id="c"]');
    expect(node?.textContent).toContain("True");
    expect(node?.textContent).toContain("False");
    expect(node?.textContent).toContain(
      "Two outputs. True: the amount is more than 5. False: the amount is 5 or less.",
    );
  });

  it("describes amount_lt's sides the other way round", () => {
    const { container } = renderCondition({ kind: "amount_lt", amountStroops: "50000000" });
    const node = container.querySelector('.react-flow__node[data-id="c"]');
    expect(node?.textContent).toContain(
      "True: the amount is less than 5. False: the amount is 5 or more.",
    );
  });

  it("gives a time condition a True and a False handle, and says which release each is", () => {
    const { container } = renderCondition({
      kind: "time_before",
      at: "2030-06-01T00:00:00.000Z",
    });
    expect(sourceHandleIds(container)).toEqual(["true", "false"]);
    const node = container.querySelector('.react-flow__node[data-id="c"]');
    expect(node?.textContent).toContain(
      "True: the funds are released before June 1, 2030 at 12:00 AM (UTC). False: the funds are released at or after June 1, 2030 at 12:00 AM (UTC).",
    );
  });

  it("gives a multisig condition its single True output and no labels", () => {
    const { container } = renderCondition({
      kind: "multisig",
      signers: ["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
      threshold: 1,
    });
    expect(sourceHandleIds(container)).toEqual(["true"]);
    const node = container.querySelector('.react-flow__node[data-id="c"]');
    expect(node?.textContent).not.toContain("False");
  });

  it("keeps a False handle on a multisig condition while an edge still uses it", () => {
    const multisig: Extract<FlowNode, { type: "condition" }>["config"] = {
      kind: "multisig",
      signers: ["GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"],
      threshold: 1,
    };
    const { container } = renderCondition(multisig, [
      { id: "e", source: "c", target: "p", sourceHandle: "false" },
    ]);
    expect(sourceHandleIds(container)).toEqual(["true", "false"]);
  });
});
