"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
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
import type { AddressEntry } from "@/lib/address-book.types";
import { TriggerNode, ActionNode, LogicNode } from "@/components/nodes";
import AnimatedStraightEdge from "@/components/nodes/animated-edge";
import ConfigPanel from "./config-panel";
import Palette from "./palette";
import DeployButton from "./deploy-button";
import RaftLog, { type ChatMessage } from "./raft-log";
import type { PatchOp } from "@/lib/ai/prompts";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  logic: LogicNode,
};

const edgeTypes = {
  straight: AnimatedStraightEdge,
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
    case "webhook":
    case "web2_webhook":
    case "subscription":
    case "oracle":
      type = "trigger";
      break;
    case "pay":
    case "split":
    case "swap":
    case "yield":
    case "email_notify":
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
  };
}

function nodeBorderColor(n: FlowNode | undefined): string {
  if (!n) return "#71717a";
  switch (n.type) {
    case "on_receive":
    case "on_schedule":
    case "webhook":
    case "web2_webhook":
    case "subscription":
    case "oracle":
      return "#98cbff";
    case "pay":
    case "split":
    case "swap":
    case "yield":
    case "email_notify":
      return "#ffb1c4";
    case "condition":
      return "#ffba20";
    default:
      return "#71717a";
  }
}

function edgeWithColors(
  e: { id: string; source: string; target: string },
  nodes: FlowNode[],
): Edge {
  const src = nodes.find((n) => n.id === e.source);
  const tgt = nodes.find((n) => n.id === e.target);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    type: "straight",
    data: {
      sourceColor: nodeBorderColor(src),
      targetColor: nodeBorderColor(tgt),
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
    initialGraph.edges.map((e) => edgeWithColors(e, initialGraph.nodes)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([]);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [ready, setReady] = useState(false);
  const [addressBook, setAddressBook] = useState<AddressEntry[]>([]);

  const refreshAddressBook = useCallback(async () => {
    const r = await fetch("/api/address-book");
    if (!r.ok) return;
    const json = await r.json();
    setAddressBook(json?.data ?? []);
  }, []);

  useEffect(() => {
    void refreshAddressBook();
  }, [refreshAddressBook]);

  useEffect(() => {
    const stored = localStorage.getItem("sidebarCollapsed");
    if (stored === "true") {
      setSidebarCollapsed(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

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
  const pendingSave = useRef<Promise<void> | null>(null);
  function saveGraph(
    currentGraph: FlowGraph,
    currentName: string,
    immediate = false,
  ): Promise<void> {
    if (saveTimer.current) clearTimeout(saveTimer.current);

    const doSave = async () => {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: currentName, graph: currentGraph }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(`Save failed: ${body?.error?.message ?? res.status}`);
      }
    };

    if (immediate) {
      pendingSave.current = doSave();
      return pendingSave.current;
    }

    pendingSave.current = new Promise((resolve) => {
      saveTimer.current = setTimeout(async () => {
        await doSave();
        resolve();
      }, 800);
    });
    return pendingSave.current;
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
    (c: Connection) => {
      const src = flowNodes.find((n) => n.id === c.source);
      const tgt = flowNodes.find((n) => n.id === c.target);
      setRfEdges((eds) =>
        addEdge(
          {
            ...c,
            type: "straight",
            data: {
              sourceColor: nodeBorderColor(src),
              targetColor: nodeBorderColor(tgt),
            },
          },
          eds,
        ),
      );
    },
    [flowNodes],
  );

  // Re-sync edge gradient colors whenever node types change
  useEffect(() => {
    setRfEdges((eds) =>
      eds.map((e) => {
        const src = flowNodes.find((n) => n.id === e.source);
        const tgt = flowNodes.find((n) => n.id === e.target);
        return {
          ...e,
          data: {
            sourceColor: nodeBorderColor(src),
            targetColor: nodeBorderColor(tgt),
          },
        };
      }),
    );
  }, [flowNodes]);

  function addNode(node: FlowNode) {
    setFlowNodes((arr) => [...arr, node]);
    setRfNodes((arr) => [...arr, nodeToReactFlow(node, arr.length)]);
  }

  function updateNode(updated: FlowNode) {
    setFlowNodes((arr) => arr.map((n) => (n.id === updated.id ? updated : n)));
    setRfNodes((arr) =>
      arr.map((n) =>
        n.id === updated.id
          ? { ...n, data: { ...n.data, node: updated, label: nodeLabel(updated) } }
          : n,
      ),
    );
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
          clarifyingQuestion?: string;
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
      const { patch, explanation, applied, missingAddresses, patchedGraph, clarifyingQuestion } =
        json.data!;

      if (clarifyingQuestion) {
        const content = explanation
          ? `${explanation}\n\n${clarifyingQuestion}`
          : clarifyingQuestion;
        setMessages((prev) => [...prev, { role: "raft", content }]);
        return;
      }

      setMessages((prev) => [...prev, { role: "raft", content: explanation, patch }]);

      if (missingAddresses && missingAddresses.length > 0) {
        setPendingAddresses((prev) => [...new Set([...prev, ...missingAddresses])]);
      }

      if (applied && patchedGraph) {
        // Use server-normalized graph directly (Issue #6 fix)
        setFlowNodes(patchedGraph.nodes);
        setRfNodes(patchedGraph.nodes.map((n, i) => nodeToReactFlow(n, i)));
        setRfEdges(patchedGraph.edges.map((e) => edgeWithColors(e, patchedGraph.nodes)));

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
      setRfEdges(resolvedFlow.edges.map((e) => edgeWithColors(e, resolvedFlow.nodes)));
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
  const pipeline = validation.ok ? validation.pipeline : undefined;
  const errors = validation.ok ? [] : validation.errors;

  return (
    <>
      <div
        suppressHydrationWarning
        className={
          ready && hasAnimated
            ? "grid gap-0 transition-[grid-template-columns] duration-300 ease-in-out"
            : "grid gap-0"
        }
        style={{
          height: "calc(100vh - 4rem)",
          gridTemplateColumns: sidebarCollapsed ? "40px 1fr" : "260px 1fr",
        }}
      >
        <Palette
          onAdd={addNode}
          flowNodes={flowNodes}
          templateKind={templateKind}
          pipeline={pipeline}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => {
            setSidebarCollapsed((v) => !v);
            setHasAnimated(true);
          }}
        />

        <div className="grid min-h-0 grid-rows-[auto_auto_1fr]">
          {/* Row 1: Deploy → editable title */}
          <div className="px-md gap-md flex items-center py-3">
            <DeployButton
              flowId={flowId}
              onClick={async (e) => {
                e.preventDefault();
                await saveGraph(graph, name, true);
                window.location.href = `/flows/${flowId}/deploy`;
              }}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Flow name"
              className="text-headline-sm text-on-surface max-w-[40ch] min-w-[12ch] flex-1 border-0 bg-transparent px-0 py-1 font-semibold tracking-[-0.01em] outline-none focus:outline-none"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
          </div>

          {/* Row 2: English Preview */}
          <div className="px-md pb-2">
            <div className="glass-panel px-md py-sm max-w-2xl rounded-xl">
              <div className="flex items-center gap-2">
                <div className="text-label-sm text-primary font-mono tracking-[0.08em] uppercase">
                  English Preview
                </div>
                {isValid && pipeline && pipeline.length > 0 && (
                  <span className="bg-primary/10 border-primary/20 text-primary text-label-sm inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono">
                    valid pipeline
                  </span>
                )}
              </div>
              <div className="text-body-md text-on-surface mt-1 line-clamp-2">{english}</div>
              {!isValid && errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {errors.map((e, i) => (
                    <div key={i} className="text-label-sm text-error font-mono">
                      {e.friendlyMessage}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Canvas */}
          <div className="relative min-h-0">
            {/* Floating ConfigPanel — shifts left when sidebar opens */}
            {selectedNode && (
              <div
                className={cn(
                  "absolute top-3 z-20 max-h-[calc(100vh-160px)] w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-all duration-300 ease-in-out",
                  !chatCollapsed ? "right-[376px]" : "right-[108px]",
                )}
              >
                <ConfigPanel
                  node={selectedNode}
                  graph={graph}
                  onChange={updateNode}
                  onDelete={deleteNode}
                  addressBook={addressBook}
                  refreshAddressBook={refreshAddressBook}
                  className="border-0"
                />
              </div>
            )}

            <ReactFlow
              nodes={rfNodes.map((n) => ({
                ...n,
                data: {
                  ...n.data,
                  label: nodeLabel(flowNodes.find((f) => f.id === n.id)),
                  node: flowNodes.find((f) => f.id === n.id) ?? n.data.node,
                },
                selected: n.id === selectedId,
              }))}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => {
                setSelectedId(null);
                if (!chatCollapsed) setChatCollapsed(true);
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
            >
              <Background gap={16} size={1} color="#27272a" />
              <Controls position="top-left" className="!top-3 !left-3" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                bgColor="#09090b"
                maskColor="rgba(9, 9, 11, 0.6)"
                nodeColor={(n) => nodeBorderColor(n.data?.node as FlowNode | undefined)}
                className="!border !border-zinc-800"
              />
            </ReactFlow>
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
      return `Pay`;
    case "split":
      return `Split (${n.config.recipients.length})`;
    case "swap":
      return `Swap`;
    case "yield":
      return `Yield`;
    case "email_notify":
      return `Email (${n.config.recipients.length})`;
    case "condition":
      return `Condition (${n.config.kind})`;
  }
}
