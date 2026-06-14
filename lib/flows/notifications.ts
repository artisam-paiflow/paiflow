import "server-only";
import type { FlowGraph, FlowNode } from "./schema";
import { assetLabel, isTrigger } from "./schema";
import { sendEmail } from "@/lib/mail";
import { db } from "@/lib/db";
import { log } from "@/lib/log";

export type EmailContext = Record<string, string>;

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
}): EmailContext {
  const { event, parentNode, graph } = params;
  const ctx: EmailContext = {
    kind: event.kind,
    ledger: String(event.ledger),
    txHash: event.txHash,
    eventId: event.eventId,
  };

  const data = event.decodedData ?? {};

  if (
    typeof data.amount === "bigint" ||
    typeof data.amount === "string" ||
    typeof data.amount === "number"
  ) {
    ctx.amount = String(data.amount);
  }
  if (
    typeof data.payment === "bigint" ||
    typeof data.payment === "string" ||
    typeof data.payment === "number"
  ) {
    ctx.amount = String(data.payment);
  }
  if (
    typeof data.amountOut === "bigint" ||
    typeof data.amountOut === "string" ||
    typeof data.amountOut === "number"
  ) {
    ctx.amount = String(data.amountOut);
  }

  if (typeof data.asset === "string") {
    const asset = graph.nodes
      .flatMap((n) => {
        const cfg = (n as { config?: Record<string, unknown> }).config ?? {};
        return [cfg.asset, cfg.assetIn, cfg.assetOut].filter(Boolean);
      })
      .find((a) => {
        const candidate = a as { kind?: string; symbol?: string; code?: string; issuer?: string };
        if (candidate.kind === "known" && candidate.symbol) return candidate.symbol === data.asset;
        if (candidate.kind === "native") return data.asset === "XLM" || data.asset === "native";
        if (candidate.code) return candidate.code === data.asset;
        return false;
      });
    ctx.asset = asset ? assetLabel(asset as Parameters<typeof assetLabel>[0]) : data.asset;
  }

  if (typeof data.from === "string") ctx.from = data.from;
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

  const ctx = buildEmailContext({ event, parentNode, graph });

  for (const node of emailNodes) {
    for (const recipient of node.config.to) {
      try {
        const exists = await db.emailNotification.findUnique({
          where: {
            contractEventId_nodeId_recipient: {
              contractEventId,
              nodeId: node.id,
              recipient,
            },
          },
        });
        if (exists) continue;

        const subject = interpolateTemplate(node.config.subject, ctx);
        const body = interpolateTemplate(node.config.body, ctx);
        const result = await sendEmail({
          to: recipient,
          subject,
          html: textToHtml(body),
          text: body,
        });

        await db.emailNotification.create({
          data: {
            contractEventId,
            nodeId: node.id,
            recipient,
            status: result.ok ? "sent" : "failed",
            error: result.ok ? null : result.error.message,
          },
        });
      } catch (err) {
        log.warn(
          { err, deploymentId, contractEventId, nodeId: node.id, recipient },
          "sendEmailNotificationsForEvent failed for recipient",
        );
      }
    }
  }
}
