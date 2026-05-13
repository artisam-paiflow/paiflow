"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { flowToEnglish } from "@/lib/flows/english";
import { FlowGraphSchema } from "@/lib/flows/schema";
import ConfigPanel from "./config-panel";
import Palette from "./palette";
import DeployButton from "./deploy-button";
import AiGenerateBar from "./ai-generate-bar";

type BuilderProps = {
  flowId: string;
  initialName: string;
  initialGraph: FlowGraph;
};

function nodeToReactFlow(n: FlowNode, index: number): Node {
  return {
    id: n.id,
    type: "default",
    position: { x: 240 + index * 40, y: 80 + index * 120 },
    data: { node: n, label: n.type },
  };
}

export default function BuilderClient(props: BuilderProps) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({ flowId, initialName, initialGraph }: BuilderProps) {
  const [name, setName] = useState(initialName);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(initialGraph.nodes);
  const [rfNodes, setRfNodes] = useState<Node[]>(
    initialGraph.nodes.map((n, i) => nodeToReactFlow(n, i)),
  );
  const [rfEdges, setRfEdges] = useState<Edge[]>(
    initialGraph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graph: FlowGraph = useMemo(
    () => ({
      nodes: flowNodes,
      edges: rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    }),
    [flowNodes, rfEdges],
  );

  const english = useMemo(() => {
    const v = FlowGraphSchema.safeParse(graph);
    return v.success ? flowToEnglish(v.data) : "(incomplete flow — fix the highlighted fields)";
  }, [graph]);

  const selectedNode = flowNodes.find((n) => n.id === selectedId) ?? null;

  // Debounced autosave
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const queuedSave = useRef(false);
  useEffect(() => {
    queuedSave.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!queuedSave.current) return;
      queuedSave.current = false;
      const res = await fetch(`/api/flows/${flowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, graph }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(`Save failed: ${body?.error?.message ?? res.status}`);
      }
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [flowId, name, graph]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setRfEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) => setRfEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [],
  );

  function addNode(node: FlowNode) {
    setFlowNodes((arr) => [...arr, node]);
    setRfNodes((arr) => [...arr, nodeToReactFlow(node, arr.length)]);
  }

  function updateNode(updated: FlowNode) {
    setFlowNodes((arr) => arr.map((n) => (n.id === updated.id ? updated : n)));
  }

  function deleteNode(id: string) {
    setFlowNodes((arr) => arr.filter((n) => n.id !== id));
    setRfNodes((arr) => arr.filter((n) => n.id !== id));
    setRfEdges((arr) => arr.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function setGraph(graph: FlowGraph) {
    setFlowNodes(graph.nodes);
    setRfNodes(graph.nodes.map((n, i) => nodeToReactFlow(n, i)));
    setRfEdges(graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    setSelectedId(null);
  }

  return (
    <div
      className="grid grid-cols-[220px_1fr_320px] gap-0"
      style={{ height: "calc(100vh - 49px)" }}
    >
      <Palette onAdd={addNode} />

      <div className="relative">
        <div className="absolute top-3 right-3 left-3 z-10 flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded bg-zinc-900/80 px-3 py-1.5 text-sm font-medium"
          />
          <DeployButton flowId={flowId} />
          <div className="flex-1" />
          <div className="w-full max-w-md">
            <AiGenerateBar onGenerate={setGraph} />
          </div>
        </div>
        <ReactFlow
          nodes={rfNodes.map((n) => ({
            ...n,
            data: { ...n.data, label: nodeLabel(flowNodes.find((f) => f.id === n.id)) },
            selected: n.id === selectedId,
          }))}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-lg bg-zinc-950/90 px-4 py-3 text-sm text-zinc-200 ring-1 ring-zinc-800">
          <div className="text-brand-400 text-[10px] tracking-wide uppercase">English preview</div>
          <div className="mt-1">{english}</div>
        </div>
      </div>

      <ConfigPanel node={selectedNode} onChange={updateNode} onDelete={deleteNode} />
    </div>
  );
}

function nodeLabel(n: FlowNode | undefined): string {
  if (!n) return "?";
  switch (n.type) {
    case "on_receive":
      return `On Receive (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
    case "on_schedule":
      return `On Schedule (${n.config.interval})`;
    case "pay":
      return `Pay`;
    case "split":
      return `Split (${n.config.recipients.length})`;
    case "condition":
      return `Condition (${n.config.kind})`;
  }
}
