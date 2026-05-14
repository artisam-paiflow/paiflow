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
import SuggestionPanel from "./suggestion-panel";

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
    style: {
      background: "#18181b",
      color: "#e4e4e7",
      border: "1px solid #3f3f46",
      borderRadius: "8px",
      padding: "10px 14px",
      fontSize: "13px",
      fontWeight: 500,
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    },
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
  const [suggestions, setSuggestions] = useState<
    Array<{ severity: "error" | "warning" | "info"; message: string }>
  >([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

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

  async function fetchSuggestions(opts?: { auto?: boolean }) {
    if (suggestLoading) return;
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/flows/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph }),
      });
      const data = await res.json().catch(() => ({ suggestions: [] }));
      setSuggestions(data.suggestions ?? []);
      if (!opts?.auto && (data.suggestions ?? []).length === 0) {
        toast.success("No issues found — your flow looks good!");
      }
    } catch {
      if (!opts?.auto) toast.error("Failed to get suggestions");
    } finally {
      setSuggestLoading(false);
    }
  }

  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  async function saveGraph(currentGraph: FlowGraph, currentName: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: currentName, graph: currentGraph }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status >= 500) {
          toast.error(`Save failed: ${body?.error?.message ?? res.status}`);
        }
      }
    }, 800);
  }

  // Autosave on name / graph changes
  useEffect(() => {
    saveGraph(graph, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFlowNodes((arr) => {
      const next = [...arr, node];
      setRfNodes((rfArr) => {
        const nextRf = [...rfArr, nodeToReactFlow(node, rfArr.length)];
        const nextGraph = {
          nodes: next,
          edges: rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        };
        saveGraph(nextGraph, name);
        return nextRf;
      });
      return next;
    });
  }

  function updateNode(updated: FlowNode) {
    setFlowNodes((arr) => {
      const next = arr.map((n) => (n.id === updated.id ? updated : n));
      const nextGraph = {
        nodes: next,
        edges: rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      };
      saveGraph(nextGraph, name);
      return next;
    });
  }

  function deleteNode(id: string) {
    setFlowNodes((arr) => {
      const next = arr.filter((n) => n.id !== id);
      setRfNodes((rfArr) => {
        const nextRf = rfArr.filter((n) => n.id !== id);
        setRfEdges((edgeArr) => {
          const nextEdges = edgeArr.filter((e) => e.source !== id && e.target !== id);
          const nextGraph = {
            nodes: next,
            edges: nextEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
          };
          saveGraph(nextGraph, name);
          return nextEdges;
        });
        return nextRf;
      });
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  }

  const appendCounter = useRef(0);

  function appendGraph(graph: FlowGraph) {
    appendCounter.current += 1;
    const batchId = appendCounter.current;

    // Offset new nodes so they don't overlap existing ones
    const maxX = rfNodes.reduce((m, n) => Math.max(m, n.position?.x ?? 0), 0);
    const offsetX = maxX + 200;

    // Remap IDs to avoid collisions with existing nodes
    const idMap = new Map<string, string>();
    const newFlowNodes = graph.nodes.map((n) => {
      const newId = `ai-${batchId}-${n.id}`;
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });

    const newRfNodes = graph.nodes.map((n, i) => {
      const rf = nodeToReactFlow({ ...n, id: idMap.get(n.id)! }, i);
      rf.position.x += offsetX;
      return rf;
    });

    let edgeIdx = 0;
    const newRfEdges = graph.edges.map((e) => {
      edgeIdx += 1;
      return {
        id: `ai-e-${batchId}-${edgeIdx}`,
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      };
    });

    setFlowNodes((arr) => [...arr, ...newFlowNodes]);
    setRfNodes((arr) => [...arr, ...newRfNodes]);
    setRfEdges((arr) => {
      const nextEdges = [...arr, ...newRfEdges];
      const nextGraph = {
        nodes: [...flowNodes, ...newFlowNodes],
        edges: nextEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      };
      saveGraph(nextGraph, name);
      return nextEdges;
    });
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
            <AiGenerateBar onGenerate={appendGraph} />
          </div>
        </div>
        <ReactFlow
          nodes={rfNodes.map((n) => ({
            ...n,
            data: { ...n.data, label: nodeLabel(flowNodes.find((f) => f.id === n.id)) },
            selected: n.id === selectedId,
          }))}
          edges={rfEdges.map((e) => ({ ...e, style: { stroke: "#71717a", strokeWidth: 2 } }))}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          fitView
        >
          <Background gap={16} size={1} color="#27272a" />
          <Controls />
        </ReactFlow>
        <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-lg bg-zinc-950/90 px-4 py-3 text-sm text-zinc-200 ring-1 ring-zinc-800">
          <div className="text-brand-400 text-[10px] tracking-wide uppercase">English preview</div>
          <div className="mt-1">{english}</div>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden">
        <div className="flex-1 overflow-auto">
          <ConfigPanel node={selectedNode} onChange={updateNode} onDelete={deleteNode} />
        </div>
        <SuggestionPanel
          suggestions={suggestions}
          loading={suggestLoading}
          onReview={() => fetchSuggestions()}
          onDismiss={(i) => setSuggestions((s) => s.filter((_, idx) => idx !== i))}
          onDismissAll={() => setSuggestions([])}
        />
      </div>
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
