import { StrKey } from "@stellar/stellar-sdk";
import type { FlowGraph, FlowNode, FlowEdge, Asset } from "@/lib/flows/schema";
import { FlowGraphSchema, isTrigger, isAction } from "@/lib/flows/schema";

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
  if (asset === "XLM" || asset === "xlm" || asset === "native") {
    return { kind: "native" };
  }
  if (asset === "USDC" || asset === "usdc") {
    return { kind: "known", symbol: "USDC" };
  }
  if (typeof asset === "string") {
    const trimmed = asset.trim();
    // Handle cases like "10usdc", "100 USDC", "10xlm" by extracting just the asset code
    const match = trimmed.match(/^(?:\d+\s*)?(usdc|xlm|native)$/i);
    if (match) {
      const code = match[1]!.toLowerCase();
      if (code === "xlm" || code === "native") return { kind: "native" };
      if (code === "usdc") return { kind: "known", symbol: "USDC" };
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
          nodes.push({
            id,
            type: "on_schedule",
            config: {
              interval: String(data.interval ?? "day") as "minute" | "hour" | "day",
              startsAt,
              endsAt: data.endsAt ? String(data.endsAt) : undefined,
            },
          } as FlowNode);
          break;
        }
        case "pay": {
          nodes.push({
            id,
            type: "pay",
            config: {
              recipient: sanitizeAddress(String(data.recipient ?? "")),
              amountStroops: String(data.amountStroops ?? data.amount ?? "0"),
              asset: normalizeAsset(data.asset),
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
          config: { interval: "day", startsAt: new Date(Date.now() + 86400000).toISOString() },
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

  // 6. Connect orphaned actions that had no incoming edge (re-check after 5)
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
