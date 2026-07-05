import { shortAddr, formatStroops } from "@/lib/utils";
import type { Asset, FlowGraph, FlowNode } from "./schema";
import {
  isContractAction,
  isLogic,
  isTrigger,
  isPendingAddress,
  bpsToPct,
  assetLabel,
} from "./schema";

function isApiFillAddress(addr: string): boolean {
  return addr === "PENDING:__api__";
}

function intervalLabel(amount: number, unit: string): string {
  if (amount === 1) {
    return `every ${unit}`;
  }
  return `every ${amount} ${unit}s`;
}

/**
 * Format an On Schedule trigger's `startsAt` as human-readable text (e.g.
 * "June 25, 2026 at 1:25 PM") instead of leaking the raw ISO timestamp into the
 * English preview. Date and time are formatted separately and joined with "at"
 * so the wording is deterministic across ICU versions. Falls back to the raw
 * string if the value isn't a parseable date.
 */
function formatScheduleStart(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = timeZone || "UTC";
  const date = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: tz,
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).format(d);
  return `${date} at ${time}`;
}

function describeCondition(c: Extract<FlowNode, { type: "condition" }>, asset?: Asset): string {
  const cfg = c.config;
  const suffix = asset ? ` ${assetLabel(asset)}` : "";
  switch (cfg.kind) {
    case "amount_gt":
      return `only if amount ≥ ${formatStroops(cfg.amountStroops)}${suffix}`;
    case "amount_lt":
      return `only if amount < ${formatStroops(cfg.amountStroops)}${suffix}`;
    case "oracle_gte":
      return `only if oracle ${shortAddr(cfg.oracle)}:${cfg.key} ≥ ${cfg.threshold}`;
    case "time_after":
      return `only after ${cfg.at}`;
    case "time_before":
      return `only before ${cfg.at}`;
    case "multisig":
      return `only after ${cfg.threshold} of ${cfg.signers.length} signers approve`;
  }
}

export function flowToEnglish(graph: FlowGraph): string {
  const trigger = graph.nodes.find(isTrigger);
  const action = graph.nodes.find(isContractAction);
  const condition = graph.nodes.find(isLogic);
  const emailNodes = graph.nodes.filter((n) => n.type === "email_notify");
  if (!trigger || !action) return "(incomplete flow)";

  let triggerText: string;
  if (trigger.type === "on_receive") {
    const min = trigger.config.minAmountStroops;
    triggerText = min
      ? `When this contract receives ≥ ${formatStroops(min)} ${assetLabel(trigger.config.asset)}`
      : `When this contract receives ${assetLabel(trigger.config.asset)}`;
  } else if (trigger.type === "webhook") {
    triggerText = `When webhook trigger fires for ${assetLabel(trigger.config.asset)}`;
  } else if (trigger.type === "web2_webhook") {
    triggerText = `When HTTP webhook fires for ${assetLabel(trigger.config.asset)}`;
  } else if (trigger.type === "subscription") {
    triggerText = `When subscription pulls ${formatStroops(trigger.config.amountPerPeriodStroops)} ${assetLabel(trigger.config.asset)} ${intervalLabel(trigger.config.intervalAmount ?? 1, trigger.config.intervalUnit ?? "day")}`;
  } else if (trigger.type === "payroll") {
    const employer = isApiFillAddress(trigger.config.employer)
      ? "(employer set via API)"
      : isPendingAddress(trigger.config.employer)
        ? "(needs employer address)"
        : shortAddr(trigger.config.employer);
    const schedule = trigger.config.fillScheduleViaApi
      ? "(schedule set via API)"
      : intervalLabel(trigger.config.intervalAmount ?? 1, trigger.config.intervalUnit ?? "week");
    const assetStr = assetLabel(trigger.config.asset);
    const pullAmountStroops =
      action.type === "split"
        ? action.config.recipients
            .filter((r) => r.mode === "fixed")
            .reduce((sum, r) => sum + BigInt(r.amountStroops || "0"), 0n)
            .toString()
        : action.type === "pay"
          ? (action.config.amountStroops ?? "0")
          : "0";
    const pullText =
      pullAmountStroops === "0" ? "" : `${formatStroops(pullAmountStroops)} ${assetStr} `;
    triggerText = `When payroll pulls ${pullText}from ${employer} ${schedule}`;
  } else if (trigger.type === "oracle") {
    triggerText = `When oracle price meets threshold (${trigger.config.threshold}) for ${assetLabel(trigger.config.asset)}`;
  } else {
    const sched = trigger.config as {
      intervalAmount?: number;
      intervalUnit?: string;
      interval?: string;
      startsAt?: string;
      timeZone?: string;
    };
    const interval = intervalLabel(
      sched.intervalAmount ?? 1,
      sched.intervalUnit ?? sched.interval ?? "hour",
    );
    triggerText = sched.startsAt
      ? `${interval} starting ${formatScheduleStart(sched.startsAt, sched.timeZone)}`
      : interval;
  }

  let actionText: string;
  if (action.type === "pay") {
    const who = isApiFillAddress(action.config.recipient)
      ? "(recipient set via API)"
      : isPendingAddress(action.config.recipient)
        ? "(needs address)"
        : shortAddr(action.config.recipient);
    if (action.config.fillValueViaApi) {
      actionText = `pay ${assetLabel(action.config.asset)} to ${who} (value set via API)`;
    } else if (action.config.fullAmount) {
      actionText = `pay full incoming ${assetLabel(action.config.asset)} to ${who}`;
    } else if (action.config.mode === "percentage") {
      actionText = `pay ${action.config.percentage}% of incoming ${assetLabel(
        action.config.asset,
      )} to ${who}`;
    } else {
      actionText = `pay ${formatStroops(action.config.amountStroops || "0")} ${assetLabel(
        action.config.asset,
      )} to ${who}`;
    }
  } else if (action.type === "swap") {
    actionText = `swap ${assetLabel(action.config.assetIn)} to ${assetLabel(action.config.assetOut)} at ${(action.config.rateBps / 100).toFixed(0)}% rate`;
  } else if (action.type === "yield") {
    const vault = isPendingAddress(action.config.vault)
      ? "(needs address)"
      : shortAddr(action.config.vault);
    actionText = `deposit ${assetLabel(action.config.asset)} into yield vault ${vault}`;
  } else if (action.type === "cash_out") {
    const bank = action.config.bankCode ? `bank ${action.config.bankCode}` : "a bank (set via API)";
    actionText = `cash out ${assetLabel(action.config.asset)} to ${bank} via off-ramp`;
  } else {
    const mode = action.config.recipients[0]?.mode ?? "percentage";
    const assetStr = assetLabel(action.config.asset);
    const parts = action.config.recipients.map((r) => {
      const who =
        r.payoutMode === "fiat"
          ? (r.accountName ?? r.label ?? "(fiat recipient)")
          : isPendingAddress(r.address)
            ? `${r.label ?? "?"} (needs address)`
            : (r.label ?? shortAddr(r.address));
      if (r.mode === "fixed") {
        return `${formatStroops(r.amountStroops)} ${assetStr} to ${who}`;
      }
      const pct = bpsToPct(r.bps);
      const pctStr = pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
      const sourceAmount =
        trigger.type === "on_receive" ? trigger.config.minAmountStroops : undefined;
      if (sourceAmount) {
        const projected = (BigInt(sourceAmount) * BigInt(r.bps)) / 10000n;
        return `${pctStr} (${formatStroops(projected.toString())} ${assetStr}) to ${who}`;
      }
      return `${pctStr} to ${who}`;
    });
    if (action.config.amountPerIntervalStroops) {
      actionText = `stream ${formatStroops(action.config.amountPerIntervalStroops)} ${assetStr} per interval — ${parts.join(", ")}`;
    } else if (action.config.ratePerSecondStroops) {
      actionText = `stream ${formatStroops(action.config.ratePerSecondStroops)} ${assetStr}/s — ${parts.join(", ")}`;
    } else if (mode === "fixed") {
      actionText = `split ${parts.join(", ")}`;
    } else {
      actionText = `split ${assetStr} — ${parts.join(", ")}`;
    }
  }

  const conditionAsset =
    trigger.type === "on_receive"
      ? trigger.config.asset
      : trigger.type === "webhook" ||
          trigger.type === "web2_webhook" ||
          trigger.type === "oracle" ||
          trigger.type === "subscription"
        ? trigger.config.asset
        : action.type === "swap"
          ? action.config.assetIn
          : action.type === "yield"
            ? action.config.asset
            : action.config.asset;
  const tail = condition ? `, ${describeCondition(condition, conditionAsset)}` : "";
  const emailTail =
    emailNodes.length > 0
      ? `, and send email notifications to ${emailNodes.flatMap((n) => n.config.recipients.map((r) => r.email)).join(", ")}`
      : "";
  return `${triggerText}, ${actionText}${tail}${emailTail}.`;
}
