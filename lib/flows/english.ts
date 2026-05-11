import { shortAddr, formatStroops } from "@/lib/utils";
import type { Asset, FlowGraph, FlowNode } from "./schema";
import { isAction, isLogic, isTrigger } from "./schema";

function assetLabel(a: Asset): string {
  if (a.kind === "native") return "XLM";
  if (a.kind === "known") return a.symbol;
  return `${a.code} (${shortAddr(a.issuer)})`;
}

function intervalLabel(i: "minute" | "hour" | "day"): string {
  return i === "minute" ? "every minute" : i === "hour" ? "every hour" : "every day";
}

function describeCondition(c: Extract<FlowNode, { type: "condition" }>): string {
  const cfg = c.config;
  switch (cfg.kind) {
    case "amount_gt":
      return `only if amount > ${formatStroops(cfg.amountStroops)}`;
    case "amount_lt":
      return `only if amount < ${formatStroops(cfg.amountStroops)}`;
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
    triggerText = `When this contract receives ${assetLabel(trigger.config.asset)}`;
  } else {
    triggerText = `${intervalLabel(trigger.config.interval)} starting ${trigger.config.startsAt}`;
  }

  let actionText: string;
  if (action.type === "pay") {
    actionText = `pay ${formatStroops(action.config.amountStroops)} ${assetLabel(
      action.config.asset,
    )} to ${shortAddr(action.config.recipient)}`;
  } else {
    const parts = action.config.recipients.map((r) => {
      const pct = (r.bps / 100).toFixed(r.bps % 100 === 0 ? 0 : 2);
      const who = r.label ?? shortAddr(r.address);
      return `${pct}% to ${who}`;
    });
    actionText = `split ${assetLabel(action.config.asset)} — ${parts.join(", ")}`;
  }

  const tail = condition ? `, ${describeCondition(condition)}` : "";
  return `${triggerText}, ${actionText}${tail}.`;
}
