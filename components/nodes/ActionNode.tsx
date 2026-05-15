"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isAction } from "@/lib/flows/schema";

type ActionNodeData = {
  node: FlowNode;
  label: string;
};

function PayIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

function ActionNodeComponent({ data }: NodeProps) {
  const d = data as ActionNodeData;
  const n = d.node;
  if (!isAction(n)) return null;

  const isPay = n.type === "pay";

  const assetLabel =
    n.config.asset.kind === "known"
      ? n.config.asset.symbol
      : n.config.asset.kind === "native"
        ? "XLM"
        : n.config.asset.code;

  return (
    <div className="relative min-w-[160px] rounded-lg border-2 border-emerald-600 bg-zinc-900 px-4 py-3 shadow-lg shadow-emerald-600/10">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-emerald-600 !bg-zinc-900"
      />

      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600/20 text-emerald-400">
          {isPay ? <PayIcon /> : <SplitIcon />}
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-200">{isPay ? "Pay" : "Split"}</div>
          <div className="text-[10px] text-zinc-500">
            {isPay
              ? `${Number(n.config.amountStroops).toLocaleString()} ${assetLabel}`
              : `${n.config.recipients.length} recipients`}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-emerald-600 !bg-zinc-900"
      />
    </div>
  );
}

export default memo(ActionNodeComponent);
