import "server-only";
import type { FlowGraph, FlowNode } from "./schema";
import { assetLabel, isTrigger } from "./schema";
import { sendEmail } from "@/lib/mail";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { formatStroops } from "@/lib/utils";

export type EmailContext = Record<string, string>;

function extractAssetKey(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string") return first;
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { code?: unknown; symbol?: unknown; asset?: unknown };
    if (typeof obj.code === "string") return obj.code;
    if (typeof obj.symbol === "string") return obj.symbol;
    if (typeof obj.asset === "string") return obj.asset;
  }
  return undefined;
}

function getParentAsset(parentNode: FlowNode | undefined): unknown {
  if (!parentNode || !("config" in parentNode)) return undefined;
  const cfg = parentNode.config as Record<string, unknown>;
  return cfg.asset ?? cfg.assetIn;
}

function resolveAssetLabel(params: {
  rawAsset: unknown;
  parentNode: FlowNode | undefined;
  graph: FlowGraph;
}): string | undefined {
  const { rawAsset, parentNode, graph } = params;
  const keys = new Set<string>();
  const eventKey = extractAssetKey(rawAsset);
  if (eventKey) keys.add(eventKey);

  const parentAsset = getParentAsset(parentNode);
  if (parentAsset && typeof parentAsset === "object") {
    const pa = parentAsset as { kind?: string; symbol?: string; code?: string };
    if (pa.kind === "native") return "XLM";
    if (pa.kind === "known" && pa.symbol) keys.add(pa.symbol);
    if (pa.kind === "custom" && pa.code) keys.add(pa.code);
  }
  const parentKey = extractAssetKey(parentAsset);
  if (parentKey) keys.add(parentKey);

  if (keys.size === 0) return undefined;

  const assets = graph.nodes.flatMap((n) => {
    const cfg = (n as { config?: Record<string, unknown> }).config ?? {};
    return [cfg.asset, cfg.assetIn, cfg.assetOut].filter(Boolean);
  });

  const match = assets.find((a) => {
    const candidate = a as { kind?: string; symbol?: string; code?: string };
    if (candidate.kind === "known" && candidate.symbol && keys.has(candidate.symbol)) return true;
    if (candidate.kind === "native" && (keys.has("XLM") || keys.has("native"))) return true;
    if (candidate.kind === "custom" && candidate.code && keys.has(candidate.code)) return true;
    return false;
  });

  return match ? assetLabel(match as Parameters<typeof assetLabel>[0]) : (eventKey ?? parentKey);
}

/**
 * Build a human-readable context map from a contract event and the parent graph
 * node that emitted it. Values are strings so they can be interpolated safely
 * into email subject/body templates.
 */
export function buildEmailContext(params: {
  event: {
    kind: string;
    ledger: number;
    txHash: string;
    eventId: string;
    decodedData: Record<string, unknown> | null;
  };
  parentNode: FlowNode | undefined;
  graph: FlowGraph;
  walletAddress: string;
  amount?: string | null;
}): EmailContext {
  const { event, parentNode, graph, walletAddress, amount } = params;
  const ctx: EmailContext = {
    kind: event.kind,
    ledger: String(event.ledger),
    txHash: event.txHash,
    eventId: event.eventId,
    walletAddress,
  };

  const data = event.decodedData ?? {};

  if (amount !== undefined && amount !== null) {
    const formatted = formatAmountValue(amount);
    if (formatted !== undefined) ctx.amount = formatted;
  } else if (amount === undefined) {
    const formatted =
      formatAmountValue(data.amount) ??
      formatAmountValue(data.payment) ??
      formatAmountValue(data.amountOut);
    if (formatted !== undefined) ctx.amount = formatted;
  }

  const resolvedAsset = resolveAssetLabel({ rawAsset: data.asset, parentNode, graph });
  if (resolvedAsset !== undefined) ctx.asset = resolvedAsset;

  if (typeof data.from === "string") ctx.from = data.from;
  ctx.recipient = walletAddress;
  if (typeof data.recipient === "string") ctx.recipient = data.recipient;
  if (typeof data.address === "string") ctx.recipient = data.address;
  if (
    typeof data.price === "bigint" ||
    typeof data.price === "string" ||
    typeof data.price === "number"
  ) {
    ctx.price = String(data.price);
  }
  if (typeof data.signer === "string") ctx.signer = data.signer;

  if (parentNode?.type === "condition") {
    const cfg = parentNode.config;
    switch (cfg.kind) {
      case "amount_gt":
        ctx.threshold = String(cfg.amountStroops);
        ctx.condition = `amount ≥ ${cfg.amountStroops}`;
        break;
      case "amount_lt":
        ctx.threshold = String(cfg.amountStroops);
        ctx.condition = `amount < ${cfg.amountStroops}`;
        break;
      case "oracle_gte":
        ctx.threshold = String(cfg.threshold);
        ctx.condition = `oracle ${cfg.key} ≥ ${cfg.threshold}`;
        break;
      case "time_after":
        ctx.condition = `after ${cfg.at}`;
        break;
      case "time_before":
        ctx.condition = `before ${cfg.at}`;
        break;
      case "multisig":
        ctx.threshold = String(cfg.threshold);
        ctx.condition = `${cfg.threshold} of ${cfg.signers.length} signers approved`;
        break;
    }
  }

  return ctx;
}

/**
 * Replace `{{variable}}` placeholders in a template string with values from the
 * provided context. Unknown variables are left unchanged.
 */
export function interpolateTemplate(template: string, ctx: EmailContext): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return ctx[key] !== undefined ? String(ctx[key]) : match;
  });
}

function textToHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function asIntegerString(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) return trimmed;
  }
  return undefined;
}

function formatAmountValue(value: unknown): string | undefined {
  const raw = asIntegerString(value);
  if (raw === undefined) return undefined;
  return formatStroops(raw);
}

/**
 * Resolve the amount (in stroops) that the given wallet address should receive
 * for this event. Prefers per-recipient event data (e.g. splitter `pay` events),
 * then falls back to calculating a share from the total amount when the parent
 * is a splitter.
 */
export function resolvePerRecipientAmount(params: {
  address: string;
  parentNode: FlowNode | undefined;
  event: { decodedData: Record<string, unknown> | null };
}): string | null | undefined {
  const { address, parentNode, event } = params;
  const data = event.decodedData ?? {};

  // Per-recipient event emitted by the contract (e.g. splitter "pay").
  if (typeof data.recipient === "string") {
    if (data.recipient === address) {
      const payment = asIntegerString(data.payment);
      if (payment !== undefined) return payment;
      const amount = asIntegerString(data.amount);
      if (amount !== undefined) return amount;
    }

    // For splitter parents, a per-recipient event for someone else should not
    // leak that person's amount into this wallet's email. Estimate this
    // wallet's share from the known payment and the source recipient's bps.
    if (parentNode?.type === "split") {
      const payment = asIntegerString(data.payment) ?? asIntegerString(data.amount);
      const sourceShare = parentNode.config.recipients.find((r) => r.address === data.recipient);
      const targetShare = parentNode.config.recipients.find((r) => r.address === address);
      if (payment !== undefined && sourceShare && targetShare) {
        try {
          const estimatedTotal = (BigInt(payment) * 10000n) / BigInt(sourceShare.bps);
          const estimated = (estimatedTotal * BigInt(targetShare.bps)) / 10000n;
          return estimated.toString();
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  // Total-amount event with a splitter parent — calculate the address's share.
  if (parentNode?.type === "split") {
    const total = asIntegerString(data.amount);
    const share = parentNode.config.recipients.find((r) => r.address === address);
    if (total !== undefined && share) {
      try {
        const perRecipient = (BigInt(total) * BigInt(share.bps)) / 10000n;
        return perRecipient.toString();
      } catch {
        return null;
      }
    }
    // Splitter parent but we can't resolve a share — don't fall back to a
    // random event field that may belong to another recipient.
    return null;
  }

  return undefined;
}

export type PipelineNodeSnapshot = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

/**
 * For a newly persisted contract event, find any `email_notify` decorator nodes
 * attached to the graph node that owns the emitting contract, render the email
 * with context variables, and send via Resend. Results are persisted in
 * EmailNotification rows with idempotency on (event, node, recipient).
 */
export async function sendEmailNotificationsForEvent(params: {
  deploymentId: string;
  contractEventId: string;
  event: {
    kind: string;
    ledger: number;
    txHash: string;
    eventId: string;
    decodedData: Record<string, unknown> | null;
  };
  graph: FlowGraph | null;
  pipeline: PipelineNodeSnapshot[] | null;
  contractAddress: string;
}): Promise<void> {
  const { deploymentId, contractEventId, event, graph, pipeline, contractAddress } = params;
  if (!graph) return;

  const pipelineNode = pipeline?.find((n) => n.contractAddress === contractAddress);
  const parentNode = (() => {
    if (!pipelineNode) return undefined;
    // The primary deployment contract is tracked with a synthetic nodeId of
    // "trigger"; map it back to the actual trigger node in the graph.
    if (pipelineNode.nodeId === "trigger") {
      return graph.nodes.find(isTrigger);
    }
    return graph.nodes.find((n) => n.id === pipelineNode.nodeId);
  })();

  const emailNodes = graph.nodes.filter((n): n is Extract<FlowNode, { type: "email_notify" }> => {
    if (n.type !== "email_notify") return false;
    return graph.edges.some((e) => e.source === (parentNode?.id ?? "") && e.target === n.id);
  });

  if (emailNodes.length === 0) return;

  for (const node of emailNodes) {
    for (const mapping of node.config.recipients) {
      const { address, email } = mapping;

      // For pay parents, the contract emits per-recipient events; skip the
      // mapping if this event is clearly for a different wallet.
      const data = event.decodedData ?? {};
      if (
        parentNode?.type === "pay" &&
        typeof data.recipient === "string" &&
        data.recipient !== address
      ) {
        continue;
      }

      const amount = resolvePerRecipientAmount({ address, parentNode, event });
      const ctx = buildEmailContext({ event, parentNode, graph, walletAddress: address, amount });

      try {
        const exists = await db.emailNotification.findUnique({
          where: {
            contractEventId_nodeId_address: {
              contractEventId,
              nodeId: node.id,
              address,
            },
          },
        });
        if (exists) continue;

        const subject = interpolateTemplate(node.config.subject, ctx);
        const body = interpolateTemplate(node.config.body, ctx);
        const result = await sendEmail({
          to: email,
          subject,
          html: textToHtml(body),
          text: body,
        });

        await db.emailNotification.create({
          data: {
            contractEventId,
            nodeId: node.id,
            address,
            recipient: email,
            status: result.ok ? "sent" : "failed",
            error: result.ok ? null : result.error.message,
          },
        });
      } catch (err) {
        log.warn(
          { err, deploymentId, contractEventId, nodeId: node.id, address, email },
          "sendEmailNotificationsForEvent failed for recipient",
        );
      }
    }
  }
}
