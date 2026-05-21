import { TemplateKind } from "@prisma/client";
import type { Asset, ActionNode, FlowGraph } from "./schema";
import { isAction, isLogic, isTrigger, sourceAmountStroops, TOTAL_BPS } from "./schema";

export type SplitterParams = {
  kind: "splitter";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  minAmountStroops?: string;
};

export type StreamerParams = {
  kind: "streamer";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  ratePerSecondStroops: string;
  startTs: number;
  endTs: number;
};

export type ConditionalParams = {
  kind: "conditional";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  amountStroops: string;
  condition: unknown;
};

export type ContractParams = SplitterParams | StreamerParams | ConditionalParams;

function getAsset(action: ActionNode): Asset {
  return action.config.asset;
}

function toRecipients(action: ActionNode): Array<{ address: string; bps: number }> {
  if (action.type === "split") {
    return action.config.recipients.map((r) => ({ address: r.address, bps: r.bps }));
  }
  return [{ address: action.config.recipient, bps: TOTAL_BPS }];
}

export function flowToParams(graph: FlowGraph, templateKind: TemplateKind): ContractParams {
  const trigger = graph.nodes.find(isTrigger)!;
  const action = graph.nodes.find(isAction)!;
  const condition = graph.nodes.find(isLogic);
  const recipients = toRecipients(action);

  if (templateKind === TemplateKind.SPLITTER) {
    const minAmountStroops =
      trigger.type === "on_receive" ? trigger.config.minAmountStroops : undefined;
    return {
      kind: "splitter",
      asset: getAsset(action),
      recipients,
      ...(minAmountStroops ? { minAmountStroops } : {}),
    };
  }

  if (templateKind === TemplateKind.STREAMER) {
    if (trigger.type !== "on_schedule") {
      throw new Error("Streamer requires an on_schedule trigger");
    }
    const start = Math.floor(new Date(trigger.config.startsAt).getTime() / 1000);
    const end = trigger.config.endsAt
      ? Math.floor(new Date(trigger.config.endsAt).getTime() / 1000)
      : start + 60 * 60 * 24 * 30;
    const rate =
      action.type === "pay"
        ? action.config.amountStroops
        : (action.config.ratePerSecondStroops ?? "1");
    return {
      kind: "streamer",
      asset: getAsset(action),
      recipients,
      ratePerSecondStroops: rate,
      startTs: start,
      endTs: end,
    };
  }

  if (templateKind === TemplateKind.CONDITIONAL) {
    const amount =
      action.type === "pay" ? action.config.amountStroops : (sourceAmountStroops(graph) ?? "0");
    return {
      kind: "conditional",
      asset: getAsset(action),
      recipients,
      amountStroops: amount,
      condition: condition?.config ?? null,
    };
  }

  throw new Error(`Unhandled template kind: ${templateKind}`);
}
