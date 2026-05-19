import { shortAddr, formatStroops } from "@/lib/utils";
import type { Asset, FlowGraph, FlowNode } from "./schema";
import { isAction, isLogic, isTrigger, isPendingAddress, bpsToPct, assetLabel } from "./schema";

function intervalLabel(i: "minute" | "hour" | "day"): string {
  return i === "minute" ? "every minute" : i === "hour" ? "every hour" : "every day";
}

function describeCondition(c: Extract<FlowNode, { type: "condition" }>, asset?: Asset): string {
  const cfg = c.config;
  const suffix = asset ? ` ${assetLabel(asset)}` : "";
  switch (cfg.kind) {
    case "amount_gt":
      return `only if amount > ${formatStroops(cfg.amountStroops)}${suffix}`;
    case "amount_lt":
      return `only if amount < ${formatStroops(cfg.amountStroops)}${suffix}`;
    case "oracle_gte":
      return `only if oracle ${shortAddr(cfg.oracle)}:${cfg.key} ≥ ${cfg.threshold}`;
    case "time_after":
      return `only after ${cfg.at}`;
    case "time_before":
      return `only before ${cfg.at}`;
  }
}

export function flowToEnglish(graph: FlowGraph): string {
  const trigger = graph.nodes.find(isTrigger);
  const action = graph.nodes.find(isAction);
  const condition = graph.nodes.find(isLogic);
  if (!trigger || !action) return "(incomplete flow)";

  let triggerText: string;
  if (trigger.type === "on_receive") {
    const min = trigger.config.minAmountStroops;
    triggerText = min
      ? `When this contract receives ≥ ${formatStroops(min)} ${assetLabel(trigger.config.asset)}`
      : `When this contract receives ${assetLabel(trigger.config.asset)}`;
  } else {
    triggerText = `${intervalLabel(trigger.config.interval)} starting ${trigger.config.startsAt}`;
  }

  let actionText: string;
  if (action.type === "pay") {
    const who = isPendingAddress(action.config.recipient)
      ? "(needs address)"
      : shortAddr(action.config.recipient);
    actionText = `pay ${formatStroops(action.config.amountStroops)} ${assetLabel(
      action.config.asset,
    )} to ${who}`;
  } else {
    const totalBps = action.config.recipients.reduce((s, r) => s + r.bps, 0);
    const sourceAmount =
      trigger.type === "on_receive" ? trigger.config.minAmountStroops : undefined;
    const parts = action.config.recipients.map((r) => {
      const pct = bpsToPct(r.bps);
      const pctStr = pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
      const who = isPendingAddress(r.address)
        ? `${r.label ?? "?"} (needs address)`
        : (r.label ?? shortAddr(r.address));
      if (sourceAmount && totalBps === 10000) {
        const projected = (BigInt(sourceAmount) * BigInt(r.bps)) / 10000n;
        return `${pctStr} (${formatStroops(projected.toString())} ${assetLabel(action.config.asset)}) to ${who}`;
      }
      return `${pctStr} to ${who}`;
    });
    const assetStr = assetLabel(action.config.asset);
    if (action.config.ratePerSecondStroops) {
      actionText = `stream ${formatStroops(action.config.ratePerSecondStroops)} ${assetStr}/s — ${parts.join(", ")}`;
    } else {
      actionText = `split ${assetStr} — ${parts.join(", ")}`;
    }
  }

  const conditionAsset = trigger.type === "on_receive" ? trigger.config.asset : action.config.asset;
  const tail = condition ? `, ${describeCondition(condition, conditionAsset)}` : "";
  return `${triggerText}, ${actionText}${tail}.`;
}
