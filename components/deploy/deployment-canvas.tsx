"use client";

import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { isAction, isLogic, isTrigger } from "@/lib/flows/schema";

type Evt = { id: string; kind: string; occurredAt: string };

function nodeLabel(n: FlowNode): string {
  switch (n.type) {
    case "on_receive":
      return `On Receive (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "on_schedule":
      return `On Schedule (${(n.config as { intervalAmount?: number; intervalUnit?: string; interval?: string }).intervalAmount ?? 1} ${(n.config as { intervalAmount?: number; intervalUnit?: string; interval?: string }).intervalUnit ?? (n.config as { interval?: string }).interval ?? "hour"})`;
    case "webhook":
      return `Webhook (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "web2_webhook":
      return `HTTP Webhook (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "subscription":
      return `Subscription (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "oracle":
      return `Oracle (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "pay":
      return "Pay";
    case "split":
      return `Split (${n.config.recipients.length})`;
    case "swap":
      return `Swap (${n.config.assetIn.kind === "known" ? n.config.assetIn.symbol : n.config.assetIn.kind} → ${n.config.assetOut.kind === "known" ? n.config.assetOut.symbol : n.config.assetOut.kind})`;
    case "yield":
      return `Yield (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "condition":
      return `Condition (${n.config.kind})`;
    default:
      return "Unknown";
  }
}

export default function DeploymentCanvas({
  graph,
  pulseTick,
}: {
  graph: FlowGraph;
  pulseTick: number;
}) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const [animatedEdges, setAnimatedEdges] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (pulseTick === 0) return;
    setAnimatedEdges(new Set(layout.edges.map((e) => e.id)));
    const t = setTimeout(() => setAnimatedEdges(new Set()), 2200);
    return () => clearTimeout(t);
  }, [pulseTick, layout.edges]);

  const edges: Edge[] = layout.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: animatedEdges.has(e.id),
    style: animatedEdges.has(e.id)
      ? { stroke: "#ffb1c4", strokeWidth: 2, strokeDasharray: 6 }
      : { stroke: "rgba(172, 135, 143, 0.4)", strokeWidth: 1.5, strokeDasharray: 4 },
  }));

  return (
    <div style={{ height: 360 }} className="canvas-grid glass-panel overflow-hidden rounded-xl">
      <ReactFlow
        nodes={layout.nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        fitView
      >
        <Background gap={24} size={1} color="rgba(0, 162, 253, 0.08)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function layoutGraph(graph: FlowGraph): {
  nodes: Node[];
  edges: { id: string; source: string; target: string }[];
} {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of graph.edges) {
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, d] of indeg)
    if (d === 0) {
      layer.set(id, 0);
      queue.push(id);
    }
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      const nl = (layer.get(id) ?? 0) + 1;
      if (nl > (layer.get(next) ?? -1)) layer.set(next, nl);
      indeg.set(next, (indeg.get(next) ?? 1) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  const layers = new Map<number, FlowNode[]>();
  for (const n of graph.nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }
  const nodes: Node[] = [];
  for (const [l, items] of layers) {
    items.forEach((n, i) => {
      const isT = isTrigger(n);
      const isA = isAction(n);
      const isL = isLogic(n);
      const tone = isT
        ? { border: "#98cbff", glow: "0 0 12px rgba(152,203,255,0.25)" }
        : isA
          ? { border: "#ffb1c4", glow: "0 0 12px rgba(255,177,196,0.25)" }
          : isL
            ? { border: "#ffba20", glow: "0 0 12px rgba(255,186,32,0.25)" }
            : { border: "rgba(172,135,143,0.4)", glow: "none" };
      nodes.push({
        id: n.id,
        type: "default",
        position: { x: 60 + i * 280, y: 60 + l * 140 },
        data: { label: nodeLabel(n) },
        draggable: false,
        style: {
          background: "rgba(28, 27, 27, 0.7)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${tone.border}`,
          color: "#e5e2e1",
          boxShadow: tone.glow,
          borderRadius: "8px",
          padding: "10px 14px",
          fontFamily: "Geist, sans-serif",
          fontSize: "13px",
        },
      });
    });
  }
  return {
    nodes,
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export type { Evt };
