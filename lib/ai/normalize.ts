import { StrKey } from "@stellar/stellar-sdk";
import type { FlowGraph, FlowNode, FlowEdge, Asset } from "@/lib/flows/schema";
import { FlowGraphSchema, isTrigger, isAction } from "@/lib/flows/schema";

/** Valid dummy Stellar address for AI-generated placeholders. */
const DUMMY_ADDRESS = "GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB";

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
  if (typeof asset === "string") {
    return { kind: "custom", code: asset, issuer: "" };
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
    // Auto-generate edges if AI forgot them
    edges = autoGenerateEdges(nodes);
  }

  try {
    const graph = FlowGraphSchema.parse({ nodes, edges });
    return { ok: true, graph };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: "Schema validation failed", detail: msg };
  }
}
