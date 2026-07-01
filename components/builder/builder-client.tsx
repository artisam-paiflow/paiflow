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
  type MiniMapNodeProps,
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

// Short, human-readable labels drawn on each node in the minimap.
const MINIMAP_NODE_LABELS: Record<FlowNode["type"], string> = {
  on_receive: "On Receive",
  on_schedule: "On Schedule",
  webhook: "Webhook",
  web2_webhook: "HTTP Webhook",
  subscription: "Subscription",
  payroll: "Payroll",
  oracle: "Oracle",
  pay: "Pay",
  split: "Split",
  swap: "Swap",
  yield: "Yield",
  cash_out: "Cash Out",
  email_notify: "Email",
  condition: "Condition",
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
    case "payroll":
    case "oracle":
      type = "trigger";
      break;
    case "pay":
    case "split":
    case "swap":
    case "yield":
    case "email_notify":
    case "cash_out":
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

/** Node types that deploy as a mutable `_DEV` contract variant when dev mode is on. */
function hasDevCounterpart(n: FlowNode | undefined): boolean {
  if (!n) return false;
  return n.type === "pay" || n.type === "split" || n.type === "subscription";
}

/**
 * Node types that deploy as a mutable contract in dev mode — either a `_DEV`
 * counterpart of an immutable node, or a dev-only node (cash_out), or a
 * trigger that decomposes into dev nodes (payroll → SUBSCRIPTION_DEV →
 * SPLITTER_DEV). Drives the amber MUTABLE badge on the canvas.
 */
function isMutableInDevMode(n: FlowNode | undefined): boolean {
  return hasDevCounterpart(n) || n?.type === "payroll" || n?.type === "cash_out";
}

function nodeBorderColor(n: FlowNode | undefined): string {
  if (!n) return "#71717a";
  switch (n.type) {
    case "on_receive":
    case "on_schedule":
    case "webhook":
    case "web2_webhook":
    case "subscription":
    case "payroll":
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
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([]);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [addressBook, setAddressBook] = useState<AddressEntry[]>([]);
  const [devMode, setDevMode] = useState<boolean>(initialGraph.devMode ?? false);

  // Floating config panel position. Both canvas panning and dragging the panel
  // header accumulate into this translate offset; it resets to the default
  // anchored position whenever a different node is opened (see effect below).
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const prevViewport = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const panelDragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

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
    } else if (stored === null && window.matchMedia("(max-width: 767px)").matches) {
      // No explicit preference yet: default collapsed on narrow viewports so the
      // canvas isn't squeezed to nothing by a fixed 260px sidebar.
      setSidebarCollapsed(true);
    }
    setReady(true);
  }, []);

  const graph: FlowGraph = useMemo(
    () => ({
      nodes: flowNodes,
      edges: rfEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      devMode,
    }),
    [flowNodes, rfEdges, devMode],
  );

  const validation = useMemo(() => validateFlow(graph), [graph]);

  const english = useMemo(() => {
    const v = FlowGraphSchema.safeParse(graph);
    return v.success ? flowToEnglish(v.data) : "(incomplete flow — fix the highlighted fields)";
  }, [graph]);

  const selectedNode = flowNodes.find((n) => n.id === selectedId) ?? null;

  // Re-anchor the floating config panel to its default position each time a
  // different node is selected (or it closes).
  useEffect(() => {
    setPanelOffset({ x: 0, y: 0 });
  }, [selectedId]);

  // Drag the panel by its header. The delta is measured from the pointer-down
  // point so it composes cleanly with any pan-follow offset already applied.
  function onPanelPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDragStart.current = {
      px: e.clientX,
      py: e.clientY,
      ox: panelOffset.x,
      oy: panelOffset.y,
    };
  }
  function onPanelPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = panelDragStart.current;
    if (!s) return;
    setPanelOffset({ x: s.ox + (e.clientX - s.px), y: s.oy + (e.clientY - s.py) });
  }
  function onPanelPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!panelDragStart.current) return;
    panelDragStart.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  // Custom minimap renderer: draw the node rectangle with its type name on top
  // (e.g. "Pay", "Split", "On Receive") so the minimap reads as labelled
  // content instead of solid blocks. The renderer only receives a node id, so
  // we look the node up via a ref kept in sync with the latest graph — that
  // lets the component identity stay stable.
  const nodeLookup = useMemo(() => new Map(flowNodes.map((n) => [n.id, n])), [flowNodes]);
  const nodeLookupRef = useRef(nodeLookup);
  nodeLookupRef.current = nodeLookup;

  const MinimapNode = useMemo(
    () =>
      function MinimapNode({ id, x, y, width, height, selected }: MiniMapNodeProps) {
        const node = nodeLookupRef.current.get(id);
        const color = nodeBorderColor(node);
        const label = node ? MINIMAP_NODE_LABELS[node.type] : "Node";
        const radius = Math.min(12, height * 0.18);
        const fontSize = Math.min(height * 0.5, 26);
        // Only clamp the text width when the label would actually overflow, so
        // short labels ("Pay", "Split") render at natural size instead of being
        // stretched edge-to-edge.
        const maxTextWidth = width * 0.86;
        const approxTextWidth = label.length * fontSize * 0.6;
        const constrainWidth = approxTextWidth > maxTextWidth;
        return (
          <g shapeRendering="geometricPrecision">
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              rx={radius}
              ry={radius}
              fill={color}
              fillOpacity={0.16}
              stroke={color}
              strokeOpacity={selected ? 1 : 0.7}
              strokeWidth={selected ? 6 : 3}
            />
            <text
              x={x + width / 2}
              y={y + height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fill={color}
              fontSize={fontSize}
              fontWeight={600}
              textLength={constrainWidth ? maxTextWidth : undefined}
              lengthAdjust={constrainWidth ? "spacingAndGlyphs" : undefined}
            >
              {label}
            </text>
          </g>
        );
      },
    [],
  );

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
    setRfNodes((arr) => {
      const rf = nodeToReactFlow(node, arr.length);
      // An index-based position can collide with an existing node once
      // deletions reshuffle the array — e.g. deleting a flow's trigger then
      // adding a new one both resolve to the same slot, stacking the new
      // trigger on top of the action node (issue #239). Drop the new node
      // below the lowest existing node so its card never lands on another.
      if (arr.length > 0) {
        const maxY = Math.max(...arr.map((n) => n.position.y));
        rf.position = { x: rf.position.x, y: maxY + 120 };
      }
      return [...arr, rf];
    });
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

  // Close the validation-issues modal on Escape, or once all issues are fixed
  // while it's open.
  useEffect(() => {
    if (!errorsModalOpen) return;
    if (errors.length === 0) {
      setErrorsModalOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setErrorsModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [errorsModalOpen, errors.length]);

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
          devMode={devMode}
          onToggleCollapse={() => {
            setSidebarCollapsed((v) => {
              const next = !v;
              localStorage.setItem("sidebarCollapsed", String(next));
              return next;
            });
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
            <button
              type="button"
              role="switch"
              aria-checked={devMode}
              onClick={() => setDevMode((v) => !v)}
              title={
                devMode
                  ? "Dev mode ON — pay / split / subscription nodes deploy as mutable variants you fill via the API"
                  : "Dev mode OFF — recipients and amounts are fixed at design time"
              }
              className={cn(
                "text-label-sm inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors",
                devMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span className="material-symbols-outlined text-[16px]">
                {devMode ? "toggle_on" : "toggle_off"}
              </span>
              Dev mode
            </button>
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
                {!isValid && errors.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setErrorsModalOpen(true)}
                    aria-label={`${errors.length} validation ${
                      errors.length === 1 ? "issue" : "issues"
                    } — view details`}
                    title="View validation issues"
                    className="bg-error/10 border-error/30 text-error hover:bg-error/20 ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px] leading-none">
                      error
                    </span>
                    <span className="text-label-sm font-semibold">{errors.length}</span>
                  </button>
                )}
              </div>
              <div className="text-body-md text-on-surface mt-1 line-clamp-2">{english}</div>
            </div>
          </div>

          {/* Row 3: Canvas */}
          <div className="relative min-h-0">
            {/* Floating ConfigPanel — anchored top-right, shifts left when the
                chat opens, and translated by panelOffset so it follows canvas
                panning and header drags. Only `right` animates so the live
                pan/drag translate stays instant. No height cap: a tall panel
                renders full height and is brought into view by pan/drag. */}
            {selectedNode && (
              <div
                className={cn(
                  "absolute top-3 z-20 w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-[right] duration-300 ease-in-out",
                  !chatCollapsed ? "right-[376px]" : "right-[108px]",
                )}
                style={{ transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)` }}
              >
                {/* Draggable header: grip + node title on the left, Delete on the
                    right. Dragging it (or panning the canvas) repositions the panel. */}
                <div
                  onPointerDown={onPanelPointerDown}
                  onPointerMove={onPanelPointerMove}
                  onPointerUp={onPanelPointerUp}
                  className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 select-none active:cursor-grabbing"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] leading-none text-zinc-500">
                      drag_indicator
                    </span>
                    <span className="text-brand-400 text-xs tracking-wider uppercase">
                      {selectedNode.type.replace("_", " ")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => deleteNode(selectedNode.id)}
                    className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                  >
                    Delete
                  </button>
                </div>
                <ConfigPanel
                  node={selectedNode}
                  graph={graph}
                  onChange={updateNode}
                  onDelete={deleteNode}
                  addressBook={addressBook}
                  refreshAddressBook={refreshAddressBook}
                  hideHeader
                  className="border-0"
                />
              </div>
            )}

            <ReactFlow
              nodes={rfNodes.map((n) => {
                const fn = flowNodes.find((f) => f.id === n.id);
                return {
                  ...n,
                  data: {
                    ...n.data,
                    label: nodeLabel(fn),
                    node: fn ?? n.data.node,
                    isMutable: devMode && isMutableInDevMode(fn),
                  },
                  selected: n.id === selectedId,
                };
              })}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => {
                setSelectedId(null);
                if (!chatCollapsed) setChatCollapsed(true);
              }}
              onMove={(_, viewport) => {
                // Follow canvas panning: translate the panel by the viewport's
                // movement delta. Zoom is ignored (panel keeps a fixed size), so
                // skip when only the zoom changed.
                const prev = prevViewport.current;
                prevViewport.current = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
                if (!prev || viewport.zoom !== prev.zoom) return;
                const dx = viewport.x - prev.x;
                const dy = viewport.y - prev.y;
                if (dx !== 0 || dy !== 0) {
                  setPanelOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
                }
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              deleteKeyCode={["Backspace", "Delete"]}
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
                nodeComponent={MinimapNode}
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

      {/* Validation issues modal — scrollable list of all errors */}
      {errorsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setErrorsModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Validation issues"
            className="bg-background-1 relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-error text-xl">error</span>
                <h3 className="text-label-lg text-on-background font-bold">
                  {errors.length} validation {errors.length === 1 ? "issue" : "issues"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setErrorsModalOpen(false)}
                aria-label="Close"
                className="text-on-background/60 hover:text-on-background flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {errors.map((e, i) => {
                const [head, ...rest] = e.friendlyMessage.split(/(?<=\.)\s+/);
                const guidance = rest.join(" ");
                return (
                  <div
                    key={i}
                    className="border-error/15 bg-background-2/50 flex items-start gap-2.5 rounded-lg border-l-2 px-3 py-2"
                  >
                    <span className="material-symbols-outlined text-error mt-0.5 text-[17px] leading-none">
                      error
                    </span>
                    <p className="text-label-sm leading-snug">
                      <span className="text-on-background font-medium">{head}</span>
                      {guidance && <span className="text-on-background/55"> {guidance}</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
    case "payroll":
      return `Payroll (${n.config.asset.kind === "known" ? n.config.asset.symbol : n.config.asset.kind})`;
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
    case "cash_out":
      return `Cash Out${n.config.bankCode ? ` (${n.config.bankCode})` : ""}`;
    case "condition":
      return `Condition (${n.config.kind})`;
  }
}
