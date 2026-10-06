"use client";

import { memo, useEffect } from "react";
import {
  Handle,
  Position,
  useNodeConnections,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isLogic } from "@/lib/flows/schema";
import { conditionOutputs, conditionOutputsDescription } from "./logic-node.utils";

type LogicNodeData = {
  node: FlowNode;
  label: string;
};

const KIND_LABELS: Record<string, string> = {
  amount_gt: "amount >",
  amount_lt: "amount <",
  oracle_gte: "oracle ≥",
  time_after: "time after",
  time_before: "time before",
  multisig: "multisig",
};

function LogicNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as LogicNodeData;
  const n = d.node;
  const falseEdges = useNodeConnections({ handleType: "source", handleId: "false" });
  const outputs = isLogic(n) ? conditionOutputs(n, falseEdges.length > 0) : [];
  const branching = outputs.length > 1;
  // Switching the kind adds or removes the False handle; React Flow has to
  // re-measure the node's handles before an edge can attach to the new one.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, branching, updateNodeInternals]);
  if (!isLogic(n)) return null;
  const description = conditionOutputsDescription(n);

  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${
        selected ? "neon-glow-tertiary" : ""
      }`}
      style={{ borderColor: selected ? undefined : "rgba(255, 186, 32, 0.3)" }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-tertiary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />

      <div className="border-tertiary/20 flex items-center justify-between border-b px-3 py-2">
        <span className="text-label-sm text-tertiary inline-flex items-center gap-1.5 font-mono">
          <span className="material-symbols-outlined text-[14px]">rule</span>
          LOGIC
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="font-display text-on-surface text-[14px] leading-tight font-semibold">
          Condition
        </div>
        <div className="text-on-surface-variant mt-1 font-mono text-[11px]">
          {KIND_LABELS[n.config.kind] ?? n.config.kind}
        </div>
        {description && <span className="sr-only">{description}</span>}
      </div>

      {branching && (
        // Each label sits above its handle. Hidden from assistive tech, which
        // reads the fuller sentence in the body instead.
        <div aria-hidden="true" className="relative h-5">
          {outputs.map((o) => (
            <span
              key={o.id}
              className="text-on-surface-variant absolute top-0 -translate-x-1/2 font-mono text-[10px] tracking-wide uppercase"
              style={{ left: `${o.leftPct}%` }}
            >
              {o.label}
            </span>
          ))}
        </div>
      )}

      {outputs.map((o) => (
        <Handle
          key={o.id}
          id={o.id}
          type="source"
          position={Position.Bottom}
          title={o.label ?? undefined}
          style={{ left: `${o.leftPct}%` }}
          className="!border-tertiary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
        />
      ))}
    </div>
  );
}

export default memo(LogicNodeComponent);
