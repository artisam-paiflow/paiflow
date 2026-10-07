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
import { toastError } from "@/lib/friendly-toast";
import { cn } from "@/lib/utils";
import type { EdgeBranch, FlowEdge, FlowGraph, FlowNode, SenderKyc } from "@/lib/flows/schema";
import { EdgeBranchSchema, isPendingAddress } from "@/lib/flows/schema";
import { BRANCH_LABEL, edgeBranch, isBranchingCondition } from "@/lib/flows/branches";
import { flowToEnglish } from "@/lib/flows/english";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow, flowHasFiatPayout } from "@/lib/flows/validate";
import type { AddressEntry } from "@/lib/address-book.types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import { TriggerNode, ActionNode, LogicNode } from "@/components/nodes";
import AnimatedStraightEdge from "@/components/nodes/animated-edge";
import { NotificationSettingsDialog } from "./notification-settings";
import { sendWithRateLimitRetry } from "./autosave-retry.utils";
import { createSaveCoordinator, type SaveOutcome } from "./save-outcome.utils";
import CanvasConfigPanel from "./canvas-config-panel";
import Palette from "./palette";
import DeployButton from "./deploy-button";
import EnglishPreview from "./english-preview";
import SenderKycDialog from "./sender-kyc-dialog";
import RaftLog, { type ChatMessage } from "./raft-log";
import type { PatchOp } from "@/lib/ai/prompts";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";
import { NODE_TYPE_LABELS } from "@/lib/flows/node-labels";
import { apiError } from "@/lib/friendly-error";
import { track } from "@/lib/analytics/client";
import { IN_SCOPE_NODE_TYPES } from "@/lib/analytics/events";
import { useValidationTracking } from "@/lib/analytics/validation-tracking";
import { NARROW_VIEWPORT_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import type { FeatureFlags } from "@/lib/feature-flags";

const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  logic: LogicNode,
};

const edgeTypes = {
  straight: AnimatedStraightEdge,
};

const IN_SCOPE_TYPES: ReadonlySet<string> = new Set(IN_SCOPE_NODE_TYPES);

function hasFiatPayoutConfig(node: FlowNode | undefined): boolean {
  const config = (node as { config?: Record<string, unknown> } | undefined)?.config;
  if (!config) return false;
  const recipients = Array.isArray(config.recipients)
    ? (config.recipients as Array<{ payoutMode?: unknown }>)
    : [];
  return config.payoutMode === "fiat" || recipients.some((r) => r.payoutMode === "fiat");
}

// Short, human-readable labels drawn on each node in the minimap.
// Shared via NODE_TYPE_LABELS so they stay in sync with the palette and panel headers.
const MINIMAP_NODE_LABELS = NODE_TYPE_LABELS;

type BuilderProps = {
  sandbox?: boolean;
  accountEmail?: string | null;
  flowId: string;
  initialName: string;
  initialGraph: FlowGraph;
  /** Pinned per environment on the server; the swap panel names it on the router field. */
  network: StellarNetwork;
  /** The Soroswap router this environment resolves to, shown read-only on the swap panel. */
  routerContractId?: string;
  /**
   * Surface switches read from the server's env at request time (#722), so a
   * restart flips them. Hides the palette entry, panel control and assistant,
   * and makes the in-builder validation match the server's refusal.
   */
  features: FeatureFlags;
};

function nodeToReactFlow(n: FlowNode, index: number, positions?: FlowGraph["positions"]): Node {
  if (n.type === "email_notify") throw new Error("Legacy graph must be migrated before rendering");
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
    case "hold":
    case "return_to_owner":
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
    // Restore the saved canvas position when present; otherwise cascade new
    // nodes down from the top-left so they don't stack on top of each other.
    position: positions?.[n.id] ?? { x: 240 + index * 40, y: 80 + index * 120 },
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
    case "hold":
    case "return_to_owner":
      return "#ffb1c4";
    case "condition":
      return "#ffba20";
    default:
      return "#71717a";
  }
}

/**
 * An edge out of a condition always carries its branch as the React Flow
 * `sourceHandle`, including a legacy handle-less one, which `edgeBranch` reads
 * as "true". Naming the handle keeps the edge on the True output rather than
 * whichever handle React Flow finds first, and the next autosave writes the
 * branch down explicitly.
 */
function edgeWithColors(e: FlowEdge, nodes: FlowNode[]): Edge {
  const src = nodes.find((n) => n.id === e.source);
  const tgt = nodes.find((n) => n.id === e.target);
  const branch = edgeBranch(e, src);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(branch ? { sourceHandle: branch } : {}),
    type: "straight",
    ariaLabel: branchLabelFor(src, branch)
      ? `${branchLabelFor(src, branch)} branch from Condition to ${tgt ? NODE_TYPE_LABELS[tgt.type] : "step"}`
      : undefined,
    data: {
      sourceColor: nodeBorderColor(src),
      targetColor: nodeBorderColor(tgt),
      branch: branchLabelFor(src, branch),
    },
  };
}

/** The chip drawn on an edge: only on a condition that has two outputs. */
function branchLabelFor(src: FlowNode | undefined, branch: EdgeBranch | null): string | undefined {
  if (!branch) return undefined;
  if (!isBranchingCondition(src) && branch === "true") return undefined;
  return BRANCH_LABEL[branch];
}

/** The persisted edge for a canvas edge: only a valid branch handle is kept. */
function toFlowEdge(e: Edge): FlowEdge {
  const branch = EdgeBranchSchema.safeParse(e.sourceHandle);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(branch.success ? { sourceHandle: branch.data } : {}),
  };
}

export default function BuilderClient(props: BuilderProps) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({
  sandbox = false,
  accountEmail,
  flowId,
  initialName,
  initialGraph,
  network,
  routerContractId,
  features,
}: BuilderProps) {
  const [name, setName] = useState(initialName);
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(initialGraph.nodes);
  const [rfNodes, setRfNodes] = useState<Node[]>(
    initialGraph.nodes.map((n, i) => nodeToReactFlow(n, i, initialGraph.positions)),
  );
  const [rfEdges, setRfEdges] = useState<Edge[]>(
    initialGraph.edges.map((e) => edgeWithColors(e, initialGraph.nodes)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // How the open panel was opened: only a keyboard open moves focus into it.
  const [openedBy, setOpenedBy] = useState<"keyboard" | "pointer">("pointer");
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const sidebarCollapsed = !sidebarOpen && !sidebarPinned;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingAddresses, setPendingAddresses] = useState<string[]>([]);
  const [hasAnimated, setHasAnimated] = useState(false);
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [addressBook, setAddressBook] = useState<AddressEntry[]>([]);
  const [addressBookLoading, setAddressBookLoading] = useState(false);
  const [addressBookError, setAddressBookError] = useState<string | null>(null);
  const [notify, setNotify] = useState<NonNullable<FlowGraph["notify"]>>({
    mode: initialGraph.notify?.mode ?? "off",
    sendTo: initialGraph.notify?.sendTo ?? accountEmail ?? "",
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [devMode, setDevMode] = useState<boolean>(initialGraph.devMode ?? false);
  const [senderKyc, setSenderKyc] = useState<SenderKyc | undefined>(initialGraph.senderKyc);
  const [kycDialogOpen, setKycDialogOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  // React Flow reports a keyboard selection (Enter/Space on a focused node) and
  // a click the same way, as `select` changes, so the canvas remembers which
  // kind of input came last.
  const lastInputRef = useRef<"keyboard" | "pointer">("pointer");
  const narrow = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  useEffect(() => {
    track("builder_opened", {
      flow_id: flowId,
      node_count: initialGraph.nodes.length,
      node_types: initialGraph.nodes.map((n) => n.type),
      dev_mode: initialGraph.devMode ?? false,
    });
    // Once per builder mount; the initial graph is what the tester walked into.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId]);

  const refreshAddressBook = useCallback(async () => {
    setAddressBookLoading(true);
    setAddressBookError(null);
    try {
      const r = await fetch("/api/address-book");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        throw apiError(body, `Failed to load contacts (HTTP ${r.status})`);
      }
      const json = await r.json();
      setAddressBook(json?.data ?? []);
    } catch (err) {
      setAddressBookError(err instanceof Error ? err.message : "Failed to load contacts");
    } finally {
      setAddressBookLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAddressBook();
  }, [refreshAddressBook]);

  useEffect(() => {
    setSidebarPinned(localStorage.getItem("sidebarPinned") === "true");
    setReady(true);
  }, []);

  const graph: FlowGraph = useMemo(
    () => ({
      nodes: flowNodes,
      edges: rfEdges.map(toFlowEdge),
      devMode,
      notify: sandbox ? { mode: "off", sendTo: "" } : notify,
      senderKyc,
      // Persist canvas positions with the flow (autosave is debounced, so a
      // drag saves once it settles rather than on every frame).
      positions: Object.fromEntries(rfNodes.map((n) => [n.id, n.position])),
    }),
    [flowNodes, rfEdges, devMode, notify, sandbox, senderKyc, rfNodes],
  );

  // Snapshot of the live canvas positions — used as a fallback when a
  // server-returned graph (AI edit, address resolution) doesn't carry them.
  const currentPositions = useCallback(
    (): FlowGraph["positions"] => Object.fromEntries(rfNodes.map((n) => [n.id, n.position])),
    [rfNodes],
  );

  // Same predicate as the validation rule: the sender KYC toolbar button only
  // appears when the flow off-ramps to fiat somewhere.
  // With the off-ramp switched off there is no KYC to collect: a fiat step is
  // refused on its node instead.
  const hasFiatPayout = useMemo(
    () => features.offramp && flowHasFiatPayout(graph),
    [graph, features.offramp],
  );

  const validation = useMemo(
    () => validateFlow(graph, { features, ignoreOwnerEmail: true }),
    [graph, features],
  );

  const english = useMemo(() => {
    const v = FlowGraphSchema.safeParse(graph);
    return v.success ? flowToEnglish(v.data) : "(incomplete flow — fix the highlighted fields)";
  }, [graph]);

  const selectedNode = flowNodes.find((n) => n.id === selectedId) ?? null;

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
  const [saves] = useState(createSaveCoordinator);
  const [deployPending, setDeployPending] = useState(false);
  const deployPendingRef = useRef(false);
  // What the next attempt sends: a retry after a 429 must carry the newest graph, not the one that
  // was current when the first attempt went out.
  const latestSave = useRef<{ graph: FlowGraph; name: string }>({ graph, name });
  // Bumped by every save scheduled; a save still waiting out a 429 yields to a newer one.
  const saveSeq = useRef(0);
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      saves.cancel();
    };
  }, [saves]);
  function saveGraph(
    currentGraph: FlowGraph,
    currentName: string,
    immediate = false,
  ): Promise<SaveOutcome> {
    latestSave.current = { graph: currentGraph, name: currentName };
    const seq = ++saveSeq.current;

    const doSave = async (): Promise<SaveOutcome> => {
      if (unmounted.current) return { ok: false };
      let res: Response | null;
      try {
        res = await sendWithRateLimitRetry(
          () =>
            fetch(`/api/flows/${flowId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: latestSave.current.name,
                graph: latestSave.current.graph,
              }),
            }),
          {
            superseded: () => saveSeq.current !== seq || unmounted.current,
            // The deploy click waits on this save, so it gets one retry, not the full budget.
            maxRetries: immediate ? 1 : undefined,
          },
        );
      } catch (err) {
        track("flow_autosave_failed", { status: null });
        if (!unmounted.current) toastError(err, "Save failed");
        return { ok: false };
      }
      // Navigation follows the newer save through the coordinator.
      if (res === null) return { ok: false };
      if (!res.ok) {
        track("flow_autosave_failed", { status: res.status });
        const body = await res.json().catch(() => ({}));
        if (!unmounted.current) toastError(body, `Save failed (${res.status})`);
      }
      return { ok: res.ok && !unmounted.current };
    };

    return saves.schedule(doSave, immediate ? 0 : 800);
  }

  useEffect(() => {
    saveGraph(graph, name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, name, graph]);

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // The one way a node's panel opens, whether by click or by Enter/Space.
  const selectNode = useCallback((id: string, via: "keyboard" | "pointer") => {
    if (id !== selectedIdRef.current) {
      const opened = nodeLookupRef.current.get(id);
      if (opened) track("node_settings_opened", { node_type: opened.type });
    }
    // A click reports twice (the `select` change, then onNodeClick) before a
    // re-render, so the ref moves now to keep the event from firing twice.
    selectedIdRef.current = id;
    setSelectedId(id);
    setOpenedBy(via);
    // Below md the panel is a bottom sheet and the chat is full-width, so only
    // one of them is shown at a time.
    if (narrowRef.current) setChatCollapsed(true);
  }, []);

  // Close and Escape hand focus back to the node the panel belongs to.
  const closePanel = useCallback(() => {
    const id = selectedIdRef.current;
    selectedIdRef.current = null;
    setSelectedId(null);
    if (!id) return;
    requestAnimationFrame(() => {
      canvasRef.current
        ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus();
    });
  }, []);

  // Sync React Flow node removals back to flowNodes (from develop)
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));

    // Keyboard selection only reaches us here: React Flow's Enter/Space on a
    // focused node selects it without calling onNodeClick, and Escape on it
    // deselects. Pointer selection goes through onNodeClick/onPaneClick; the
    // `select` changes a drag start emits are ignored so a drag opens nothing.
    const keyboard = lastInputRef.current === "keyboard";
    const selected = changes.find(
      (c): c is { type: "select"; id: string; selected: true } => c.type === "select" && c.selected,
    );
    if (selected && keyboard) {
      selectNode(selected.id, "keyboard");
    } else if (
      changes.some(
        (c) =>
          (c.type === "remove" || (keyboard && c.type === "select")) &&
          c.id === selectedIdRef.current,
      )
    ) {
      selectedIdRef.current = null;
      setSelectedId(null);
    }

    const removedIds = changes
      .filter((c): c is { type: "remove"; id: string } => c.type === "remove")
      .map((c) => c.id);

    if (removedIds.length > 0) {
      for (const id of removedIds) {
        const removed = nodeLookupRef.current.get(id);
        if (removed) track("node_removed", { node_type: removed.type, via: "keyboard" });
      }
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
      track("edge_connected", {
        from_type: src?.type ?? "unknown",
        to_type: tgt?.type ?? "unknown",
      });
      // The handle the user dragged from is the branch; edgeWithColors derives
      // the colours, the chip and the accessible name from it.
      const branch = EdgeBranchSchema.safeParse(c.sourceHandle);
      const drawn = edgeWithColors(
        {
          id: `xy-edge__${c.source}${c.sourceHandle ?? ""}-${c.target}${c.targetHandle ?? ""}`,
          source: c.source,
          target: c.target,
          ...(branch.success ? { sourceHandle: branch.data } : {}),
        },
        flowNodes,
      );
      setRfEdges((eds) => addEdge(drawn, eds));
    },
    [flowNodes],
  );

  // Re-sync edge gradient colors whenever node types change
  useEffect(() => {
    setRfEdges((eds) =>
      eds.map((e) => {
        const src = flowNodes.find((n) => n.id === e.source);
        const tgt = flowNodes.find((n) => n.id === e.target);
        const branch = edgeBranch(toFlowEdge(e), src);
        return {
          ...e,
          data: {
            sourceColor: nodeBorderColor(src),
            targetColor: nodeBorderColor(tgt),
            branch: branchLabelFor(src, branch),
          },
        };
      }),
    );
  }, [flowNodes]);

  function addNode(node: FlowNode) {
    track("node_added", { node_type: node.type });
    if (!IN_SCOPE_TYPES.has(node.type)) {
      track("off_script_feature_used", { feature: `node:${node.type}` });
    }
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
    if (
      hasFiatPayoutConfig(updated) &&
      !hasFiatPayoutConfig(nodeLookupRef.current.get(updated.id))
    ) {
      track("off_script_feature_used", { feature: "fiat_payout" });
    }
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
    const removed = nodeLookupRef.current.get(id);
    if (removed) track("node_removed", { node_type: removed.type, via: "panel" });
    setFlowNodes((arr) => arr.filter((n) => n.id !== id));
    setRfNodes((arr) => arr.filter((n) => n.id !== id));
    setRfEdges((arr) => arr.filter((e) => e.source !== id && e.target !== id));
    if (selectedId === id) setSelectedId(null);
  }

  async function sendChat(text: string) {
    track("off_script_feature_used", { feature: "ask_ai_chat" });
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
        if (patchedGraph.notify) setNotify(patchedGraph.notify);
        setRfNodes(
          patchedGraph.nodes.map((n, i) =>
            nodeToReactFlow(n, i, patchedGraph.positions ?? currentPositions()),
          ),
        );
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
        toastError(json, "Failed to resolve addresses");
        return;
      }
      const resolvedFlow = json.data.flow as FlowGraph;
      setFlowNodes(resolvedFlow.nodes);
      setRfNodes(
        resolvedFlow.nodes.map((n, i) =>
          nodeToReactFlow(n, i, resolvedFlow.positions ?? currentPositions()),
        ),
      );
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
  const pipeline = validation.ok ? validation.pipeline : undefined;
  const errors = useMemo(() => (validation.ok ? [] : validation.errors), [validation]);
  useValidationTracking(errors, flowNodes);

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
      {/* The canvas sits behind the header, palette and toolbar in tab order;
          this lands keyboard users on the first node instead. */}
      <button
        type="button"
        onClick={() => {
          const first = canvasRef.current?.querySelector<HTMLElement>(".react-flow__node");
          (first ?? canvasRef.current)?.focus();
        }}
        className="bg-primary text-on-primary text-label-md font-body sr-only rounded-lg font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:z-50 focus:-translate-x-1/2 focus:px-3 focus:py-2"
      >
        Skip to canvas
      </button>
      <div
        suppressHydrationWarning
        className={
          ready && hasAnimated
            ? "builder-grid grid gap-0 transition-[grid-template-columns] duration-300 ease-in-out"
            : "grid gap-0"
        }
        style={{
          height: "calc(100dvh - 4rem)",
          // minmax(0, …): a bare 1fr grows to the toolbar's content width,
          // which pushed the page past a phone's screen.
          gridTemplateColumns: sidebarCollapsed ? "40px minmax(0, 1fr)" : "260px minmax(0, 1fr)",
        }}
      >
        <div
          className="min-h-0 min-w-0"
          onMouseEnter={() => {
            setSidebarOpen(true);
            setHasAnimated(true);
          }}
          onMouseLeave={() => {
            setSidebarOpen(false);
            setHasAnimated(true);
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget) &&
              !event.currentTarget.matches(":hover")
            ) {
              setSidebarOpen(false);
              setHasAnimated(true);
            }
          }}
        >
          <Palette
            onAdd={addNode}
            flowNodes={flowNodes}
            collapsed={sidebarCollapsed}
            pinned={sidebarPinned}
            devMode={devMode}
            features={features}
            onExpand={() => {
              setSidebarOpen(true);
              setHasAnimated(true);
            }}
            onTogglePin={() => {
              const next = !sidebarPinned;
              setSidebarPinned(next);
              localStorage.setItem("sidebarPinned", String(next));
              setSidebarOpen(true);
              setHasAnimated(true);
            }}
          />
        </div>

        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr]">
          {/* Row 1: Deploy → editable title */}
          <div className="px-md gap-md max-md:gap-sm flex flex-wrap items-center py-3 max-md:flex-nowrap max-md:px-3 max-md:py-2">
            <DeployButton
              flowId={flowId}
              disabled={!isValid}
              pending={deployPending}
              errorCount={errors.length}
              onClick={async (e) => {
                e.preventDefault();
                if (!isValid || deployPendingRef.current) return;
                deployPendingRef.current = true;
                setDeployPending(true);
                try {
                  await saves.navigateAfterSave(saveGraph(graph, name, true), () => {
                    if (!unmounted.current) window.location.href = `/flows/${flowId}/deploy`;
                  });
                } finally {
                  deployPendingRef.current = false;
                  if (!unmounted.current) setDeployPending(false);
                }
              }}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Flow name"
              className="text-headline-sm max-md:text-body-lg text-on-surface max-w-[40ch] min-w-[12ch] flex-1 border-0 bg-transparent px-0 py-1 font-semibold tracking-[-0.01em] outline-none focus:outline-none max-md:min-w-0"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            {!sandbox && (
              <button
                id="notification-settings-button"
                type="button"
                aria-expanded={notificationsOpen}
                aria-label="Email notifications"
                className="border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface inline-flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors"
                onClick={() => setNotificationsOpen((v) => !v)}
              >
                <span aria-hidden="true" className="material-symbols-outlined">
                  mail
                </span>
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={devMode}
              aria-label="Dev mode"
              onClick={() => {
                if (!devMode) track("off_script_feature_used", { feature: "dev_mode_on" });
                setDevMode((v) => !v);
              }}
              title={
                devMode
                  ? "Dev mode ON — pay / split / subscription nodes deploy as mutable variants you fill via the API"
                  : "Dev mode OFF — recipients and amounts are fixed at design time"
              }
              className={cn(
                "text-label-sm inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors max-md:px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                devMode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant hover:text-on-surface",
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                {devMode ? "toggle_on" : "toggle_off"}
              </span>
              <span className="max-md:sr-only">Dev mode</span>
            </button>
          </div>

          {!sandbox && notificationsOpen && (
            <NotificationSettingsDialog
              value={notify}
              onChange={setNotify}
              onClose={() => {
                setNotificationsOpen(false);
                document.getElementById("notification-settings-button")?.focus();
              }}
            />
          )}
          {/* Row 2: English Preview */}
          <EnglishPreview
            english={english}
            showValidBadge={isValid && !!pipeline && pipeline.length > 0}
            hasFiatPayout={hasFiatPayout}
            hasSenderKyc={!!senderKyc}
            devMode={devMode}
            errorCount={isValid ? 0 : errors.length}
            onOpenKyc={() => setKycDialogOpen(true)}
            onOpenErrors={() => {
              track("errors_modal_opened", { error_count: errors.length });
              setErrorsModalOpen(true);
            }}
          />

          {/* Row 3: Canvas */}
          <div
            ref={canvasRef}
            tabIndex={-1}
            className="relative min-h-0 focus:outline-none"
            onKeyDownCapture={() => {
              lastInputRef.current = "keyboard";
            }}
            onPointerDownCapture={() => {
              lastInputRef.current = "pointer";
            }}
          >
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
              onNodeClick={(_, n) => selectNode(n.id, "pointer")}
              onPaneClick={() => {
                setSelectedId(null);
                if (!chatCollapsed) setChatCollapsed(true);
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
                // The minimap renders above the config panel (docked sheet or
                // floating card) and would swallow clicks on it, so it steps
                // aside while a panel is open. On a phone it would cover a
                // node's worth of canvas and the Ask AI button, so it's off.
                className={cn("!border !border-zinc-800 max-md:!hidden", selectedId && "!hidden")}
              />
              {selectedId && selectedNode && (
                <CanvasConfigPanel
                  selectedId={selectedId}
                  node={selectedNode}
                  graph={graph}
                  errors={errors}
                  network={network}
                  routerContractId={routerContractId}
                  features={features}
                  sandbox={sandbox}
                  onChange={updateNode}
                  onDelete={deleteNode}
                  addressBook={addressBook}
                  refreshAddressBook={refreshAddressBook}
                  addressBookLoading={addressBookLoading}
                  addressBookError={addressBookError}
                  chatCollapsed={chatCollapsed}
                  canvasRef={canvasRef}
                  onClose={closePanel}
                  focusOnOpen={openedBy === "keyboard"}
                />
              )}
            </ReactFlow>
          </div>
        </div>
      </div>

      {/* Railway-style slide-in chat panel; absent when the assistant is off (#722). */}
      {features.aiAssistant && (
        <RaftLog
          messages={messages}
          onSend={sendChat}
          loading={chatLoading}
          pendingAddresses={pendingAddresses}
          onResolveAddress={handleResolveAddress}
          onSkipAddresses={handleSkipAddresses}
          collapsed={chatCollapsed}
          // Below md the docked sheet sits over the tab's corner; hiding it keeps
          // it out of the tab order instead of focusable but unseen.
          hideTab={narrow && !!selectedId && !!selectedNode}
          onToggleCollapse={() => {
            // Opening the chat below md dismisses the docked panel (see selectNode).
            if (chatCollapsed && narrow) setSelectedId(null);
            setChatCollapsed((v) => !v);
          }}
        />
      )}

      {/* Sender KYC dialog — design-time capture of the PDAX sender profile */}
      {kycDialogOpen && features.offramp && (
        <SenderKycDialog
          initial={senderKyc}
          onSave={(kyc) => {
            setSenderKyc(kyc);
            setKycDialogOpen(false);
            toast.success("Sender KYC saved with the flow");
          }}
          onClose={() => setKycDialogOpen(false)}
        />
      )}

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
  if (!n || n.type === "email_notify") return "?";
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
    case "hold":
      return "Hold";
    case "return_to_owner":
      return "Return to owner";
    case "pay":
      return `Pay`;
    case "split":
      return `Split (${n.config.recipients.length})`;
    case "swap":
      return `Swap`;
    case "yield":
      return `Yield`;
    case "cash_out":
      return `Cash Out${n.config.bankCode ? ` (${n.config.bankCode})` : ""}`;
    case "condition":
      return `Condition (${n.config.kind})`;
  }
}
