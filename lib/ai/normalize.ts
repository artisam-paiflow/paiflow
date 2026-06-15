import { StrKey } from "@stellar/stellar-sdk";
import type { FlowGraph, FlowNode, FlowEdge, Asset } from "@/lib/flows/schema";
import { FlowGraphSchema, isTrigger, isAction, isLogic } from "@/lib/flows/schema";
import type { PatchOp } from "./prompts";

export function applyPatch(graph: FlowGraph, patch: PatchOp[]): FlowGraph {
  const nodes = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, structuredClone(n)]));
  const edges = new Map<string, FlowEdge>(graph.edges.map((e) => [e.id, structuredClone(e)]));

  for (const op of patch) {
    switch (op.op) {
      case "updateNode": {
        const existing = nodes.get(op.id);
        if (!existing) throw new Error(`updateNode: node ${op.id} not found`);
        nodes.set(op.id, { ...existing, config: { ...existing.config, ...op.config } } as FlowNode);
        break;
      }
      case "addNode": {
        const node = op.node as FlowNode;
        if (nodes.has(node.id)) throw new Error(`addNode: node ${node.id} already exists`);
        nodes.set(node.id, node);
        if (op.edge) {
          if (edges.has(op.edge.id)) throw new Error(`addNode: edge ${op.edge.id} already exists`);
          edges.set(op.edge.id, op.edge);
        }
        break;
      }
      case "removeNode": {
        if (!nodes.has(op.id)) throw new Error(`removeNode: node ${op.id} not found`);
        nodes.delete(op.id);
        for (const [eid, e] of edges) {
          if (e.source === op.id || e.target === op.id) {
            edges.delete(eid);
          }
        }
        break;
      }
      case "addEdge": {
        if (edges.has(op.edge.id)) throw new Error(`addEdge: edge ${op.edge.id} already exists`);
        edges.set(op.edge.id, op.edge);
        break;
      }
      case "removeEdge": {
        if (!edges.has(op.id)) continue;
        edges.delete(op.id);
        break;
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

function makeEdgeId() {
  return `auto-e-${Math.random().toString(36).slice(2, 8)}`;
}

export function autoConnectOrphans(graph: FlowGraph): FlowGraph {
  const trigger = graph.nodes.find(isTrigger);
  if (!trigger) return graph;

  // BFS from trigger to find all reachable nodes
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)?.push(e.target);

  const reachable = new Set<string>();
  const queue = [trigger.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) ?? []) queue.push(next);
  }

  // Collect orphan action/logic nodes
  const orphans = graph.nodes.filter((n) => !reachable.has(n.id) && (isAction(n) || isLogic(n)));
  if (!orphans.length) return graph;

  // Find the leaf of the reachable subgraph (a node with no outgoing edges inside reachable)
  let leaf = trigger.id;
  const seen = new Set<string>();
  const stack = [trigger.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const children = (adj.get(id) ?? []).filter((c) => reachable.has(c));
    if (!children.length) leaf = id;
    else for (const c of children) stack.push(c);
  }

  // Chain edges: leaf → orphan1 → orphan2 → ...
  const newEdges: FlowEdge[] = [];
  let prev = leaf;
  for (const orphan of orphans) {
    newEdges.push({ id: makeEdgeId(), source: prev, target: orphan.id });
    prev = orphan.id;
  }

  return { ...graph, edges: [...graph.edges, ...newEdges] };
}

export function stripZeroBpsRecipients(graph: FlowGraph): FlowGraph {
  const nodes = graph.nodes.map((n) => {
    if (n.type !== "split") return n;
    const filtered = n.config.recipients.filter((r) =>
      r.mode === "percentage" ? r.bps > 0 : BigInt(r.amountStroops) > 0n,
    );
    if (filtered.length === n.config.recipients.length) return n;
    return { ...n, config: { ...n.config, recipients: filtered } } as FlowNode;
  });
  return { ...graph, nodes };
}

/** Valid dummy Stellar address for AI-generated placeholders. */
const DUMMY_ADDRESS = "GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB";

/** Warnings collected during normalization — surfaced as non-blocking hints. */
export type NormalizeWarning = { nodeId?: string; message: string };

type NormalizeContext = {
  warnings: NormalizeWarning[];
  autoIdCounter: number;
  usedNodeIds: Set<string>;
};

function nextAutoId(ctx: NormalizeContext): string {
  while (true) {
    const id = `auto_${ctx.autoIdCounter++}`;
    if (!ctx.usedNodeIds.has(id)) {
      ctx.usedNodeIds.add(id);
      return id;
    }
  }
}

function sanitizeAddress(addr: string): string {
  if (StrKey.isValidEd25519PublicKey(addr)) return addr;
  return DUMMY_ADDRESS;
}

function normalizeAsset(asset: unknown): Asset {
  if (
    asset === "XLM" ||
    asset === "xlm" ||
    asset === "native" ||
    asset === "lumens" ||
    asset === "lumen" ||
    asset === "stellar"
  ) {
    return { kind: "native" };
  }
  if (
    asset === "USDC" ||
    asset === "usdc" ||
    asset === "USD" ||
    asset === "dollars" ||
    asset === "usd coin"
  ) {
    return { kind: "known", symbol: "USDC" };
  }
  if (typeof asset === "string") {
    const trimmed = asset.trim();
    // Handle cases like "10usdc", "100 USDC", "10xlm" by extracting just the asset code
    const match = trimmed.match(/^(?:\d+\s*)?(usdc|xlm|native|lumens?|stellar|usd|dollars)$/i);
    if (match) {
      const code = match[1]!.toLowerCase();
      if (
        code === "xlm" ||
        code === "native" ||
        code === "lumens" ||
        code === "lumen" ||
        code === "stellar"
      )
        return { kind: "native" };
      if (code === "usdc" || code === "usd" || code === "dollars")
        return { kind: "known", symbol: "USDC" };
    }
    // If it looks like a Stellar asset code (1-12 alphanumeric), treat as custom
    if (/^[a-zA-Z0-9]{1,12}$/.test(trimmed)) {
      return { kind: "custom", code: trimmed.toUpperCase(), issuer: DUMMY_ADDRESS };
    }
    return { kind: "custom", code: trimmed, issuer: DUMMY_ADDRESS };
  }
  if (typeof asset === "object" && asset !== null) {
    const a = asset as Record<string, unknown>;
    if ("kind" in a) {
      if (a.kind === "native") return { kind: "native" };
      if (a.kind === "known" && "symbol" in a)
        return { kind: "known", symbol: String(a.symbol) as "USDC" };
      if (a.kind === "custom" && "code" in a && "issuer" in a) {
        return {
          kind: "custom",
          code: String(a.code),
          issuer: sanitizeAddress(String(a.issuer)),
        };
      }
    }
    if ("code" in a && "issuer" in a) {
      return { kind: "custom", code: String(a.code), issuer: sanitizeAddress(String(a.issuer)) };
    }
  }
  return { kind: "native" };
}

function normalizeBps(
  recipients: Array<{ address: string; bps: number; label: string }>,
): Array<{ address: string; bps: number; label: string }> {
  const sum = recipients.reduce((s, r) => s + r.bps, 0);
  if (sum === 10_000) return recipients;
  if (sum === 0) {
    // Equal distribution
    const each = Math.floor(10_000 / recipients.length);
    const remainder = 10_000 - each * recipients.length;
    return recipients.map((r, i) => ({
      ...r,
      bps: i === 0 ? each + remainder : each,
    }));
  }
  // Normalize proportionally
  return recipients.map((r) => ({
    ...r,
    bps: Math.round((r.bps / sum) * 10_000),
  }));
}

function autoGenerateEdges(nodes: FlowNode[]): FlowEdge[] {
  if (nodes.length < 2) return [];

  const triggers = nodes.filter(isTrigger);
  const actions = nodes.filter(isAction);
  const logic = nodes.filter((n) => n.type === "condition");

  const edges: FlowEdge[] = [];
  let edgeId = 0;

  if (triggers.length === 1) {
    const trigger = triggers[0]!;
    if (logic.length === 1 && actions.length === 1) {
      // Trigger → Condition → Action
      edges.push({
        id: `e${edgeId++}`,
        source: trigger.id,
        target: logic[0]!.id,
      });
      edges.push({
        id: `e${edgeId++}`,
        source: logic[0]!.id,
        target: actions[0]!.id,
      });
    } else if (actions.length >= 1) {
      // Trigger → Action
      edges.push({
        id: `e${edgeId++}`,
        source: trigger.id,
        target: actions[0]!.id,
      });
    }
  }

  return edges;
}

export type NormalizeResult =
  | { ok: true; graph: FlowGraph }
  | { ok: false; error: string; detail?: string };

export function normalizeFlowGraph(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "AI response is not an object" };
  }
  const obj = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  if (rawNodes.length === 0) {
    return { ok: false, error: "AI generated an empty flow (no nodes)" };
  }

  const nodes: FlowNode[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const n = rawNodes[i];
    if (!n || typeof n !== "object") {
      return { ok: false, error: `Node ${i} is not an object` };
    }
    const node = n as Record<string, unknown>;
    const id = String(node.id ?? `n${i}`);
    const type = String(node.type);
    const data = (node.config ?? node.data ?? {}) as Record<string, unknown>;

    try {
      switch (type) {
        case "on_receive": {
          nodes.push({
            id,
            type: "on_receive",
            config: { asset: normalizeAsset(data.asset) },
          } as FlowNode);
          break;
        }
        case "on_schedule": {
          const startsAt = String(data.startsAt ?? "2026-05-20T00:00:00Z");
          const intervalUnit = String(data.intervalUnit ?? data.interval ?? "day") as
            | "minute"
            | "hour"
            | "day"
            | "week"
            | "month";
          nodes.push({
            id,
            type: "on_schedule",
            config: {
              intervalAmount: data.intervalAmount ? Number(data.intervalAmount) : 1,
              intervalUnit,
              startsAt,
              endsAt: data.endsAt ? String(data.endsAt) : undefined,
              occurrences: data.occurrences ? Number(data.occurrences) : undefined,
              timeZone: data.timeZone ? String(data.timeZone) : undefined,
              pauseAllowed:
                data.pauseAllowed !== undefined ? Boolean(data.pauseAllowed) : undefined,
              retrieveAllowed:
                data.retrieveAllowed !== undefined ? Boolean(data.retrieveAllowed) : undefined,
            },
          } as FlowNode);
          break;
        }
        case "pay": {
          const mode = (data.mode === "percentage" ? "percentage" : "fixed") as
            | "fixed"
            | "percentage";
          const fullAmount = Boolean(data.fullAmount);
          const percentage = typeof data.percentage === "number" ? data.percentage : undefined;
          nodes.push({
            id,
            type: "pay",
            config: {
              recipient: sanitizeAddress(String(data.recipient ?? "")),
              amountStroops: String(data.amountStroops ?? data.amount ?? "0"),
              asset: normalizeAsset(data.asset),
              mode,
              ...(percentage !== undefined ? { percentage } : {}),
              fullAmount,
            },
          } as FlowNode);
          break;
        }
        case "split": {
          let recipients = Array.isArray(data.recipients)
            ? data.recipients.map((r: unknown, j: number) => {
                if (!r || typeof r !== "object") throw new Error(`Recipient ${j} is not an object`);
                const rec = r as Record<string, unknown>;
                return {
                  address: sanitizeAddress(String(rec.address ?? "")),
                  bps: Number(rec.bps ?? 0),
                  label: rec.label ? String(rec.label) : `Recipient ${j + 1}`,
                };
              })
            : [];

          if (recipients.length < 2) {
            // AI generated too few recipients — split into two
            const first = recipients[0]!;
            const half = Math.floor(first.bps / 2);
            recipients = [
              { ...first, bps: half },
              { address: DUMMY_ADDRESS, bps: first.bps - half, label: "Recipient 2" },
            ];
          }

          // Ensure all labels are strings (not undefined)
          recipients = recipients.map((r) => ({
            ...r,
            label: r.label ?? `Recipient`,
          }));

          recipients = normalizeBps(recipients);

          nodes.push({
            id,
            type: "split",
            config: {
              asset: normalizeAsset(data.asset),
              recipients,
            },
          } as FlowNode);
          break;
        }
        case "condition": {
          const cfg = data as Record<string, unknown>;
          const kind = String(cfg.kind ?? "amount_gt");
          switch (kind) {
            case "amount_gt":
              nodes.push({
                id,
                type: "condition",
                config: {
                  kind: "amount_gt",
                  amountStroops: String(cfg.amountStroops ?? cfg.amount ?? "0"),
                },
              } as FlowNode);
              break;
            case "amount_lt":
              nodes.push({
                id,
                type: "condition",
                config: {
                  kind: "amount_lt",
                  amountStroops: String(cfg.amountStroops ?? cfg.amount ?? "0"),
                },
              } as FlowNode);
              break;
            case "oracle_gte":
              nodes.push({
                id,
                type: "condition",
                config: {
                  kind: "oracle_gte",
                  oracle: sanitizeAddress(String(cfg.oracle ?? "")),
                  key: String(cfg.key ?? ""),
                  threshold: String(cfg.threshold ?? "0"),
                },
              } as FlowNode);
              break;
            case "time_after":
              nodes.push({
                id,
                type: "condition",
                config: {
                  kind: "time_after",
                  at: String(cfg.at ?? "2026-05-20T00:00:00Z"),
                },
              } as FlowNode);
              break;
            case "time_before":
              nodes.push({
                id,
                type: "condition",
                config: {
                  kind: "time_before",
                  at: String(cfg.at ?? "2026-05-20T00:00:00Z"),
                },
              } as FlowNode);
              break;
            default:
              nodes.push({
                id,
                type: "condition",
                config: { kind: "amount_gt", amountStroops: "0" },
              } as FlowNode);
          }
          break;
        }
        default:
          return { ok: false, error: `Unknown node type: ${type}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Error parsing node ${i}: ${msg}` };
    }
  }

  let edges: FlowEdge[];
  if (rawEdges.length > 0) {
    edges = rawEdges.map((e: unknown, i: number) => {
      if (!e || typeof e !== "object") {
        return { id: `e${i}`, source: "", target: "" };
      }
      const edge = e as Record<string, unknown>;
      return {
        id: String(edge.id ?? `e${i}`),
        source: String(edge.source ?? ""),
        target: String(edge.target ?? ""),
      };
    });
  } else {
    edges = autoGenerateEdges(nodes);
  }

  // ── Rescue mutations ──────────────────────────────────────────────
  const rescued = rescueFlow(nodes, edges, {
    warnings: [],
    autoIdCounter: 0,
    usedNodeIds: new Set(nodes.map((n) => n.id)),
  });

  try {
    const graph = FlowGraphSchema.parse({ nodes: rescued.nodes, edges: rescued.edges });
    return { ok: true, graph };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "Schema validation failed", detail: msg };
  }
}

// ── Rescue helpers ──────────────────────────────────────────────────

function removeNode(nodes: FlowNode[], id: string): FlowNode[] {
  return nodes.filter((n) => n.id !== id);
}

function buildNodeMap(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/**
 * Rescue a flow that would otherwise fail validation.
 * Mutates nodes/edges in-place-like style (returns new arrays).
 */
function rescueFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  ctx: NormalizeContext,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  let rescuedNodes = [...nodes];
  let rescuedEdges = [...edges];
  let nodeMap = buildNodeMap(rescuedNodes);

  // 1. Strip edges that reference non-existent nodes
  rescuedEdges = rescuedEdges.filter((e) => {
    if (!nodeMap.has(e.source)) {
      ctx.warnings.push({ message: `Removed edge referencing unknown source ${e.source}` });
      return false;
    }
    if (!nodeMap.has(e.target)) {
      ctx.warnings.push({ message: `Removed edge referencing unknown target ${e.target}` });
      return false;
    }
    return true;
  });

  // 2. Too many triggers → keep only the first, merge the rest as actions
  const triggers = rescuedNodes.filter(isTrigger);
  if (triggers.length > 1) {
    const primary = triggers[0]!;
    ctx.warnings.push({
      nodeId: primary.id,
      message: `Merged ${triggers.length - 1} extra trigger(s) into primary trigger ${primary.id}`,
    });

    // Rewire: any edge pointing TO a removed trigger → point to primary instead
    const removedIds = new Set(triggers.slice(1).map((t) => t.id));
    rescuedEdges = rescuedEdges.map((e) => ({
      ...e,
      source: removedIds.has(e.source) ? primary.id : e.source,
      target: removedIds.has(e.target) ? primary.id : e.target,
    }));

    // Remove duplicate self-loops
    rescuedEdges = rescuedEdges.filter((e) => e.source !== e.target);

    // Remove extra trigger nodes
    rescuedNodes = rescuedNodes.filter((n) => !removedIds.has(n.id));
    nodeMap = buildNodeMap(rescuedNodes);
  }

  // 3. No trigger → infer one
  if (!rescuedNodes.some(isTrigger)) {
    const hasSchedule = rescuedNodes.some((n) => n.type === "on_schedule");
    const asset = inferAssetFromNodes(rescuedNodes);
    const triggerId = nextAutoId(ctx);
    const trigger: FlowNode = hasSchedule
      ? {
          id: triggerId,
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: new Date(Date.now() + 86400000).toISOString(),
            timeZone: "UTC",
          },
        }
      : ({ id: triggerId, type: "on_receive", config: { asset } } as FlowNode);

    ctx.warnings.push({
      nodeId: triggerId,
      message: hasSchedule
        ? "No trigger found — added default on_schedule"
        : "No trigger found — added default on_receive",
    });

    rescuedNodes = [trigger, ...rescuedNodes];
    nodeMap = buildNodeMap(rescuedNodes);
  }

  // 4. Trigger has incoming edges → strip them (trigger must be root)
  const trigger = rescuedNodes.find(isTrigger);
  if (trigger) {
    const incomingCount = rescuedEdges.filter((e) => e.target === trigger.id).length;
    if (incomingCount > 0) {
      rescuedEdges = rescuedEdges.filter((e) => e.target !== trigger.id);
      ctx.warnings.push({
        nodeId: trigger.id,
        message: `Removed ${incomingCount} incoming edge(s) to trigger — triggers must be roots`,
      });
    }
  }

  // 5. Connect orphaned actions (actions with no incoming edge) to trigger
  const hasIncoming = new Set(rescuedEdges.map((e) => e.target));
  const actions = rescuedNodes.filter(isAction);
  const logicNodes = rescuedNodes.filter((n) => n.type === "condition");
  const usedEdgeIds = new Set(rescuedEdges.map((e) => e.id));

  if (trigger) {
    let newEdgeId =
      Math.max(0, ...rescuedEdges.map((e) => parseInt(e.id.replace(/\D/g, "")) || 0)) + 1;

    // Connect orphaned logic nodes to trigger
    for (const ln of logicNodes) {
      if (!hasIncoming.has(ln.id)) {
        const eid = `e${newEdgeId++}`;
        while (usedEdgeIds.has(eid)) {
          newEdgeId++;
        }
        rescuedEdges.push({ id: eid, source: trigger.id, target: ln.id });
        usedEdgeIds.add(eid);
        hasIncoming.add(ln.id);
        ctx.warnings.push({ nodeId: ln.id, message: "Connected orphaned condition to trigger" });
      }
    }

    // Connect orphaned actions to trigger or condition
    for (const act of actions) {
      if (!hasIncoming.has(act.id)) {
        // Prefer connecting to a condition if one exists and it has no outgoing to this action yet
        const targetLogic = logicNodes.find(
          (l) => !rescuedEdges.some((e) => e.source === l.id && e.target === act.id),
        );
        const source = targetLogic ?? trigger;
        const eid = `e${newEdgeId++}`;
        while (usedEdgeIds.has(eid)) {
          newEdgeId++;
        }
        rescuedEdges.push({ id: eid, source: source.id, target: act.id });
        usedEdgeIds.add(eid);
        hasIncoming.add(act.id);
        ctx.warnings.push({ nodeId: act.id, message: "Connected orphaned action to flow" });
      }
    }
  }

  return { nodes: rescuedNodes, edges: rescuedEdges };
}

function inferAssetFromNodes(nodes: FlowNode[]): Asset {
  for (const n of nodes) {
    if (n.type === "on_receive" && "asset" in n.config) return (n.config as { asset: Asset }).asset;
    if (n.type === "pay" && "asset" in n.config) return (n.config as { asset: Asset }).asset;
    if (n.type === "split" && "asset" in n.config) return (n.config as { asset: Asset }).asset;
  }
  return { kind: "known", symbol: "USDC" } as Asset;
}
