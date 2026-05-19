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
import { cn } from "@/lib/utils";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { isPendingAddress } from "@/lib/flows/schema";
import { flowToEnglish } from "@/lib/flows/english";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { TriggerNode, ActionNode, LogicNode } from "@/components/nodes";
import ConfigPanel from "./config-panel";
import Palette from "./palette";
import DeployButton from "./deploy-button";
import RaftLog, { type ChatMessage } from "./raft-log";
import type { PatchOp } from "@/lib/ai/prompts";

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  logic: LogicNode,
};

const TEMPLATE_LABELS: Record<string, string> = {
  SPLITTER: "Splitter",
  STREAMER: "Streamer",
  CONDITIONAL: "Conditional",
};

type BuilderProps = {
  flowId: string;
  initialName: string;
  initialGraph: FlowGraph;
};

function nodeToReactFlow(n: FlowNode, index: number): Node {
  let type: "trigger" | "action" | "logic";
  switch (n.type) {
    case "on_receive":
    case "on_schedule":
      type = "trigger";
      break;
    case "pay":
    case "split":
      type = "action";
      break;
    case "condition":
      type = "logic";
      break;
    default: {
      const _exhaustive: never = n;
      throw new Error(`Unknown node type: ${(_exhaustive as FlowNode).type}`);
    }
  }
  return {
    id: n.id,
    type,
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
    initialGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "straight",
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([]);

  const graph: FlowGraph = useMemo(
    () => ({
      nodes: flowNodes,
      edges: rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    }),
    [flowNodes, rfEdges],
  );

  const validation = useMemo(() => validateFlow(graph), [graph]);

  const english = useMemo(() => {
    const v = FlowGraphSchema.safeParse(graph);
    return v.success ? flowToEnglish(v.data) : "(incomplete flow — fix the highlighted fields)";
  }, [graph]);

  const selectedNode = flowNodes.find((n) => n.id === selectedId) ?? null;

  // Autosave with 800ms debounce (from develop)
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

  useEffect(() => {
    saveGraph(graph, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, name, graph]);

  // Sync React Flow node removals back to flowNodes (from develop)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));

    const removedIds = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => c.id);

    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      setFlowNodes((arr) => arr.filter((n) => !removedSet.has(n.id)));
      setRfEdges((eds) =>
        eds.filter((e) => !removedSet.has(e.source) && !removedSet.has(e.target)),
      );
    }
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setRfEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) =>
      setRfEdges((eds) => addEdge({ ...c, type: "straight", animated: true }, eds)),
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

  async function sendChat(text: string) {
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = (await res.json()) as {
        data?: {
          patch: PatchOp[];
          explanation: string;
          applied: boolean;
          missingAddresses?: string[];
          patchedGraph?: FlowGraph;
          templateKind?: string;
        };
        error?: { message: string; fields?: Record<string, string[]> };
      };
      if (!res.ok) {
        let content = json.error?.message ?? "Something went wrong.";
        const fields = json.error?.fields;
        if (fields && Object.keys(fields).length > 0) {
          const details = Object.entries(fields)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("\n");
          content += `\n\nDetails:\n${details}`;
        }
        setMessages((prev) => [...prev, { role: "raft", content }]);
        return;
      }
      const { patch, explanation, applied, missingAddresses, patchedGraph } = json.data!;
      setMessages((prev) => [...prev, { role: "raft", content: explanation, patch }]);

      if (missingAddresses && missingAddresses.length > 0) {
        setPendingAddresses((prev) => [...new Set([...prev, ...missingAddresses])]);
      }

      if (applied && patchedGraph) {
        // Use server-normalized graph directly (Issue #6 fix)
        setFlowNodes(patchedGraph.nodes);
        setRfNodes(patchedGraph.nodes.map((n, i) => nodeToReactFlow(n, i)));
        setRfEdges(
          patchedGraph.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            animated: true,
            type: "straight",
          })),
        );

        // Show address prompt if the resulting graph has pending addresses
        const pending = scanPendingLabels(patchedGraph.nodes);
        setPendingAddresses(pending);

        toast.success("Flow updated");
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "raft", content: "Network error. Please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  function scanPendingLabels(nodes: FlowNode[]): string[] {
    const labels = new Set<string>();
    for (const n of nodes) {
      if (n.type === "split") {
        for (const r of n.config.recipients) {
          if (isPendingAddress(r.address)) {
            labels.add(r.label ?? "unnamed");
          }
        }
      }
      if (n.type === "pay" && isPendingAddress(n.config.recipient)) {
        const label = n.config.recipient.slice(8) || "unnamed";
        labels.add(label);
      }
    }
    return [...labels];
  }

  async function handleResolveAddress(addresses: Record<string, string>) {
    setChatLoading(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/resolve-addresses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Failed to resolve addresses");
        return;
      }
      const resolvedFlow = json.data.flow as FlowGraph;
      setFlowNodes(resolvedFlow.nodes);
      setRfNodes(resolvedFlow.nodes.map((n, i) => nodeToReactFlow(n, i)));
      setRfEdges(
        resolvedFlow.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: true,
          type: "straight",
        })),
      );
      setPendingAddresses([]);
      setMessages((prev) => [
        ...prev,
        { role: "raft", content: `Addresses resolved: ${Object.keys(addresses).join(", ")}` },
      ]);
      toast.success(`Addresses resolved for ${json.data.resolved} recipients`);
    } catch {
      toast.error("Network error while resolving addresses");
    } finally {
      setChatLoading(false);
    }
  }

  function handleSkipAddresses() {
    setPendingAddresses([]);
  }

  const isValid = validation.ok;
  const templateKind = validation.ok ? validation.templateKind : null;
  const errors = validation.ok ? [] : validation.errors;

  return (
    <>
      <div className="grid grid-cols-[220px_1fr] gap-0" style={{ height: "calc(100vh - 49px)" }}>
        <Palette onAdd={addNode} flowNodes={flowNodes} />

        <div className="relative flex flex-col">
          <div className="relative flex-1">
            {/* Top-left: name + deploy + AI toggle */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded bg-zinc-900/80 px-3 py-1.5 text-sm font-medium"
              />
              <DeployButton flowId={flowId} />
              <button
                onClick={() => setChatCollapsed((v) => !v)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  !chatCollapsed
                    ? "bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700"
                    : "bg-brand-600 hover:bg-brand-500 text-white",
                )}
              >
                {!chatCollapsed ? "Close AI" : "Edit with AI"}
              </button>
            </div>

            {/* Floating ConfigPanel — shifts left when sidebar opens */}
            {selectedNode && (
              <div
                className={cn(
                  "absolute top-3 z-20 max-h-[calc(100vh-100px)] w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-all duration-300 ease-in-out",
                  !chatCollapsed ? "right-[340px]" : "right-3",
                )}
              >
                <ConfigPanel
                  node={selectedNode}
                  graph={graph}
                  onChange={updateNode}
                  onDelete={deleteNode}
                  className="border-0"
                />
              </div>
            )}

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
              onPaneClick={() => {
                setSelectedId(null);
                if (!chatCollapsed) setChatCollapsed(true);
              }}
              nodeTypes={nodeTypes}
              fitView
            >
              <Background gap={16} size={1} color="#27272a" />
              <Controls />
            </ReactFlow>

            {/* Validation status badge */}
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2">
              {templateKind && (
                <span className="text-brand-400 ring-brand-500/50 rounded-full bg-zinc-900/90 px-3 py-1 text-xs ring-1">
                  {TEMPLATE_LABELS[templateKind] ?? templateKind}
                </span>
              )}
            </div>

            {/* English preview + validation errors */}
            <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-lg bg-zinc-950/90 px-4 py-3 text-sm text-zinc-200 ring-1 ring-zinc-800">
              <div className="mb-1 flex items-center gap-2">
                <div className="text-brand-400 text-[10px] tracking-wide uppercase">
                  English preview
                </div>
                {isValid && templateKind && (
                  <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    valid {TEMPLATE_LABELS[templateKind]?.toLowerCase()}
                  </span>
                )}
              </div>
              <div className="mt-1">{english}</div>
              {!isValid && errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {errors.map((e, i) => (
                    <div key={i} className="text-[11px] text-red-400">
                      {e.friendlyMessage}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Railway-style slide-in chat panel */}
      <RaftLog
        messages={messages}
        onSend={sendChat}
        loading={chatLoading}
        pendingAddresses={pendingAddresses}
        onResolveAddress={handleResolveAddress}
        onSkipAddresses={handleSkipAddresses}
        collapsed={chatCollapsed}
        onToggleCollapse={() => setChatCollapsed((v) => !v)}
      />
    </>
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
