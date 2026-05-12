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
      return `On Schedule (${n.config.interval})`;
    case "pay":
      return "Pay";
    case "split":
      return `Split (${n.config.recipients.length})`;
    case "condition":
      return `Condition (${n.config.kind})`;
  }
}

export default function DeploymentCanvas({
  graph,
  pulseTick,
}: {
  graph: FlowGraph;
  pulseTick: number; // increment to trigger a fan-out animation
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
      ? { stroke: "#f43f74", strokeWidth: 2.5 }
      : { stroke: "#52525b" },
  }));

  return (
    <div style={{ height: 360 }} className="rounded-xl border border-zinc-800 bg-zinc-950">
      <ReactFlow
        nodes={layout.nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function layoutGraph(graph: FlowGraph): {
  nodes: Node[];
  edges: { id: string; source: string; target: string }[];
} {
  // Simple top-down layout based on topological order.
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
      const color = isT
        ? "border-brand-500"
        : isA
          ? "border-emerald-600"
          : isL
            ? "border-amber-500"
            : "border-zinc-700";
      nodes.push({
        id: n.id,
        type: "default",
        position: { x: 60 + i * 280, y: 60 + l * 140 },
        data: { label: nodeLabel(n) },
        className: `bg-zinc-900 border-2 ${color} text-white`,
        draggable: false,
      });
    });
  }
  return {
    nodes,
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export type { Evt };
