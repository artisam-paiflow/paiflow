import "server-only";
import { sendEmail } from "@/lib/mail";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { stellarExpertTxUrl, isStellarNetwork } from "@/lib/stellar/explorer";
import { log } from "@/lib/log";
import { formatStroops } from "@/lib/utils";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import {
  assetLabel,
  FlowGraphSchema,
  migrateFlowGraph,
  isValidEmailAddress,
} from "@/lib/flows/schema";
import {
  inboundAsset,
  resolveEmittingNode,
  type PipelineNodeSnapshot,
} from "@/lib/flows/event-assets";

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

function resolveAssetLabel(params: {
  rawAsset: unknown;
  parentNode: FlowNode | undefined;
  graph: FlowGraph;
}): string | undefined {
  const { rawAsset, parentNode, graph } = params;
  const keys = new Set<string>();
  const eventKey = extractAssetKey(rawAsset);
  if (eventKey === "USDC" || eventKey === "XLM") return eventKey;
  if (eventKey) keys.add(eventKey);

  const parentAsset = inboundAsset(parentNode);
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

  if (event.kind === "SHORTFALL") {
    const deposited = formatAmountValue(data.amount);
    const balance = formatAmountValue(data.balance);
    const needed = formatAmountValue(data.needed);
    const remaining = formatAmountValue(data.remaining);
    if (deposited !== undefined) ctx.amount = deposited;
    if (balance !== undefined) ctx.balance = balance;
    if (needed !== undefined) ctx.needed = needed;
    if (remaining !== undefined) ctx.remaining = remaining;
    ctx.shortfall = `Insufficient funds: deposited ${deposited ?? data.amount ?? ""} ${ctx.asset ?? ""}, balance ${balance ?? data.balance ?? ""}, needed ${needed ?? data.needed ?? ""}, remaining ${remaining ?? data.remaining ?? ""}`;
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
        ctx.condition = `amount > ${cfg.amountStroops}`;
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

export type { PipelineNodeSnapshot } from "@/lib/flows/event-assets";

/** Dispatch only after the poll pass has persisted every contract through this ledger. */
export async function sendEmailNotificationsForTransactions(params: {
  deploymentId: string;
  startLedger: number;
  throughLedger: number;
}): Promise<void> {
  const { deploymentId, startLedger, throughLedger } = params;
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: { owner: { select: { role: true } }, flow: { select: { name: true } } },
  });
  if (!deployment?.owner || deployment.owner.role === "SANDBOX") return;
  const parsed = FlowGraphSchema.safeParse(migrateFlowGraph(deployment.graphSnapshot));
  if (!parsed.success || !isStellarNetwork(deployment.network)) return;
  const graph = parsed.data;
  const recipientRows = graph.nodes.flatMap<{ address: string; email?: string }>((n) =>
    n.type === "pay"
      ? [{ address: n.config.recipient, email: n.config.email }]
      : n.type === "split"
        ? n.config.recipients
        : [],
  );
  const ownerEnabled =
    graph.notify?.mode !== "off" && isValidEmailAddress(graph.notify?.sendTo.trim() ?? "");
  if (!ownerEnabled && !recipientRows.some((r) => isValidEmailAddress(r.email?.trim() ?? "")))
    return;
  const events = await db.contractEvent.findMany({
    where: { deploymentId, ledger: { gte: startLedger, lte: throughLedger } },
    orderBy: [{ ledger: "asc" }, { eventId: "asc" }],
  });
  const transactions = new Map<string, typeof events>();
  for (const event of events) {
    const rows = transactions.get(event.txHash) ?? [];
    rows.push(event);
    transactions.set(event.txHash, rows);
  }
  const network = deployment.network;
  const short = (address: string) => `${address.slice(0, 5)}…${address.slice(-4)}`;

  for (const [txHash, rows] of transactions) {
    const messages: {
      kind: string;
      address: string;
      email: string;
      summary: string;
      owner: boolean;
    }[] = [];
    const summaries: string[] = [];
    for (const row of rows) {
      const data =
        row.decodedData && typeof row.decodedData === "object" && !Array.isArray(row.decodedData)
          ? (row.decodedData as Record<string, unknown>)
          : {};
      const payload = row.payload as { contractAddress?: string } | null;
      const parentNode = resolveEmittingNode({
        graph,
        pipeline: deployment.pipelineSnapshot as PipelineNodeSnapshot[] | null,
        contractAddress: payload?.contractAddress ?? "",
      });
      const held =
        parentNode?.type === "condition" &&
        (parentNode.config.kind === "time_before" || parentNode.config.kind === "time_after") &&
        graph.edges.some(
          (e) =>
            e.source === parentNode.id &&
            graph.nodes.find((h) => h.id === e.target)?.type === "hold",
        );
      const ctx = buildEmailContext({
        event: { ...row, decodedData: data },
        parentNode,
        graph,
        walletAddress: String(data.recipient ?? ""),
      });
      const asset =
        ctx.asset ??
        graph.nodes.flatMap((n) => ("asset" in n.config ? [assetLabel(n.config.asset)] : []))[0] ??
        "asset";
      const amount = ctx.amount ?? formatAmountValue(data.balance);
      if (row.kind === "PAYOUT" && data.amountOut !== undefined) {
        const output = formatAmountValue(data.amountOut);
        const input = formatAmountValue(data.amountIn);
        if (output)
          summaries.push(
            `Swapped ${input ?? "unknown"} ${String(data.assetIn ?? asset)} for ${output} ${String(data.assetOut ?? asset)}`,
          );
      }
      if (
        (row.kind === "CLAIM" ||
          row.kind === "RETRIEVE" ||
          row.kind === "CANCEL" ||
          row.kind === "CASH_OUT") &&
        amount
      ) {
        summaries.push(
          `${row.kind === "CASH_OUT" ? "Sent for fiat payout" : row.kind === "CLAIM" ? "Claimed" : "Returned"} ${amount} ${asset}`,
        );
      }
      if (row.kind === "PAYOUT" && typeof data.recipient !== "string" && amount && data.branch)
        summaries.push(`Released ${amount} ${asset} (${String(data.branch)})`);
      if (row.kind === "RECEIVE" && amount) {
        if (held && parentNode?.type === "condition" && "at" in parentNode.config)
          summaries.push(`${amount} ${asset} held until ${parentNode.config.at}`);
        else if (parentNode?.type !== "condition") summaries.push(`Received ${amount} ${asset}`);
      }
      if (row.kind === "SHORTFALL")
        summaries.push(`Deposit falls short: ${ctx.remaining ?? "unknown"} ${asset} still needed`);
      if (row.kind === "PAYOUT" && typeof data.recipient === "string" && amount) {
        const summary = `Paid ${amount} ${asset} to ${short(data.recipient)}`;
        summaries.push(summary);
        const nodeRows =
          parentNode?.type === "pay"
            ? [{ address: parentNode.config.recipient, email: parentNode.config.email }]
            : parentNode?.type === "split"
              ? parentNode.config.recipients
              : parentNode
                ? []
                : recipientRows;
        const mapping = nodeRows.find((r) => r.address === data.recipient && r.email?.trim());
        if (mapping?.email && isValidEmailAddress(mapping.email.trim()))
          messages.push({
            kind: "recipient",
            address: `${row.eventId}:${data.recipient}`,
            email: mapping.email.trim(),
            summary,
            owner: false,
          });
      }
    }
    const notify = graph.notify;
    if (
      notify &&
      notify.mode !== "off" &&
      isValidEmailAddress(notify.sendTo.trim()) &&
      (notify.mode === "every_transaction"
        ? summaries.length > 0
        : rows.some((r) => r.kind === "SHORTFALL"))
    ) {
      messages.unshift({
        kind: "owner",
        address: "",
        email: notify.sendTo.trim(),
        summary: summaries.join(". "),
        owner: true,
      });
    }
    for (const message of messages) {
      const deliveryKey = `${deploymentId}:${txHash}:${message.kind}:${message.address}`;
      // Claim before sending: concurrent polls and retries cannot send twice.
      const claim = await db.emailNotification.createMany({
        data: [
          {
            contractEventId: rows[0]!.id,
            nodeId: message.kind,
            address: message.address,
            recipient: message.email,
            deploymentId,
            txHash,
            kind: message.kind,
            deliveryKey,
            status: "pending",
          },
        ],
        skipDuplicates: true,
      });
      if (claim.count === 0) continue;
      const limit = await rateLimit(`email:deployment:${deploymentId}`, 30, 3600);
      if (!limit.ok || (env().NODE_ENV === "production" && !limit.shared)) {
        await db.emailNotification.update({ where: { deliveryKey }, data: { status: "skipped" } });
        log.info({ deploymentId, txHash }, "Notification email skipped by deployment limit");
        continue;
      }
      const text = `${message.summary}.\n\n${network.toUpperCase()}\n${stellarExpertTxUrl(txHash, network)}${message.owner ? `\n${env().NEXT_PUBLIC_APP_URL}/deployments/${deploymentId}` : ""}`;
      const result = await sendEmail({
        to: message.email,
        subject: `${deployment.flow.name}: ${message.owner ? (rows.some((r) => r.kind === "SHORTFALL") ? "Deposit falls short" : `${summaries[0] ?? "Money moved"}${summaries.some((summary) => summary.startsWith("Paid ")) ? " and paid out" : ""}`) : message.summary}`,
        text,
        html: textToHtml(text),
      });
      await db.emailNotification.update({
        where: { deliveryKey },
        data: {
          status: result.ok ? "sent" : "failed",
          error: result.ok ? null : "Email delivery failed",
        },
      });
    }
  }
}
