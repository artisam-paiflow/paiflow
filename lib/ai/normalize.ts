import { StrKey } from "@stellar/stellar-sdk";
import type { FlowGraph, FlowNode, FlowEdge, Asset } from "@/lib/flows/schema";
import { FlowGraphSchema } from "@/lib/flows/schema";

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
          issuer: String(a.issuer),
        };
      }
    }
    if ("code" in a && "issuer" in a) {
      return { kind: "custom", code: String(a.code), issuer: String(a.issuer) };
    }
  }
  // Fallback for unknown strings
  if (typeof asset === "string") {
    return { kind: "custom", code: asset, issuer: "" };
  }
  return { kind: "native" };
}

export function normalizeFlowGraph(raw: unknown): FlowGraph {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI response is not an object");
  }
  const obj = raw as Record<string, unknown>;

  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: FlowNode[] = rawNodes.map((n: unknown, i: number) => {
    if (!n || typeof n !== "object") throw new Error(`Node ${i} is not an object`);
    const node = n as Record<string, unknown>;
    const id = String(node.id ?? `n${i}`);
    const type = String(node.type);
    const data = (node.data ?? node.config ?? {}) as Record<string, unknown>;

    switch (type) {
      case "on_receive": {
        return {
          id,
          type: "on_receive",
          config: { asset: normalizeAsset(data.asset) },
        } as FlowNode;
      }
      case "on_schedule": {
        return {
          id,
          type: "on_schedule",
          config: {
            interval: String(data.interval ?? "day") as "minute" | "hour" | "day",
            startsAt: String(data.startsAt ?? new Date().toISOString()),
            endsAt: data.endsAt ? String(data.endsAt) : undefined,
          },
        } as FlowNode;
      }
      case "pay": {
        return {
          id,
          type: "pay",
          config: {
            recipient: sanitizeAddress(String(data.recipient ?? "")),
            amountStroops: String(data.amountStroops ?? data.amount ?? "0"),
            asset: normalizeAsset(data.asset),
          },
        } as FlowNode;
      }
      case "split": {
        const recipients = Array.isArray(data.recipients)
          ? data.recipients.map((r: unknown, j: number) => {
              if (!r || typeof r !== "object") throw new Error(`Recipient ${j} is not an object`);
              const rec = r as Record<string, unknown>;
              return {
                address: sanitizeAddress(String(rec.address ?? "")),
                bps: Number(rec.bps ?? 0),
                label: rec.label ? String(rec.label) : undefined,
              };
            })
          : [];
        return {
          id,
          type: "split",
          config: {
            asset: normalizeAsset(data.asset),
            recipients,
          },
        } as FlowNode;
      }
      case "condition": {
        const cfg = data as Record<string, unknown>;
        const kind = String(cfg.kind ?? "amount_gt");
        switch (kind) {
          case "amount_gt":
            return {
              id,
              type: "condition",
              config: {
                kind: "amount_gt",
                amountStroops: String(cfg.amountStroops ?? cfg.amount ?? "0"),
              },
            } as FlowNode;
          case "amount_lt":
            return {
              id,
              type: "condition",
              config: {
                kind: "amount_lt",
                amountStroops: String(cfg.amountStroops ?? cfg.amount ?? "0"),
              },
            } as FlowNode;
          case "oracle_gte":
            return {
              id,
              type: "condition",
              config: {
                kind: "oracle_gte",
                oracle: sanitizeAddress(String(cfg.oracle ?? "")),
                key: String(cfg.key ?? ""),
                threshold: String(cfg.threshold ?? "0"),
              },
            } as FlowNode;
          case "time_after":
            return {
              id,
              type: "condition",
              config: {
                kind: "time_after",
                at: String(cfg.at ?? new Date().toISOString()),
              },
            } as FlowNode;
          case "time_before":
            return {
              id,
              type: "condition",
              config: {
                kind: "time_before",
                at: String(cfg.at ?? new Date().toISOString()),
              },
            } as FlowNode;
          default:
            return {
              id,
              type: "condition",
              config: { kind: "amount_gt", amountStroops: "0" },
            } as FlowNode;
        }
      }
      default:
        throw new Error(`Unknown node type: ${type}`);
    }
  });

  const edges: FlowEdge[] = rawEdges.map((e: unknown, i: number) => {
    if (!e || typeof e !== "object") throw new Error(`Edge ${i} is not an object`);
    const edge = e as Record<string, unknown>;
    return {
      id: String(edge.id ?? `e${i}`),
      source: String(edge.source ?? ""),
      target: String(edge.target ?? ""),
    };
  });

  return FlowGraphSchema.parse({ nodes, edges });
}
