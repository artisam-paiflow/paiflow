import { TemplateKind } from "@prisma/client";
import type { Asset, FlowGraph } from "./schema";
import { isAction, isLogic, isTrigger } from "./schema";

export type SplitterParams = {
  kind: "splitter";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
};

export type StreamerParams = {
  kind: "streamer";
  asset: Asset;
  recipient: string;
  ratePerSecondStroops: string;
  startTs: number;
  endTs: number;
};

export type ConditionalParams = {
  kind: "conditional";
  asset: Asset;
  recipient: string;
  amountStroops: string;
  condition: unknown;
};

export type ContractParams = SplitterParams | StreamerParams | ConditionalParams;

export function flowToParams(graph: FlowGraph, templateKind: TemplateKind): ContractParams {
  const trigger = graph.nodes.find(isTrigger)!;
  const action = graph.nodes.find(isAction)!;
  const condition = graph.nodes.find(isLogic);

  if (templateKind === TemplateKind.SPLITTER) {
    if (action.type === "split") {
      return {
        kind: "splitter",
        asset: action.config.asset,
        recipients: action.config.recipients.map((r) => ({ address: r.address, bps: r.bps })),
      };
    }
    if (action.type === "pay") {
      // Pay-through: one recipient with 10000 bps
      return {
        kind: "splitter",
        asset: action.config.asset,
        recipients: [{ address: action.config.recipient, bps: 10_000 }],
      };
    }
  }

  if (templateKind === TemplateKind.STREAMER) {
    if (trigger.type !== "on_schedule" || action.type !== "pay") {
      throw new Error("Streamer requires on_schedule → pay");
    }
    const start = Math.floor(new Date(trigger.config.startsAt).getTime() / 1000);
    const intervalSeconds =
      trigger.config.interval === "minute" ? 60 : trigger.config.interval === "hour" ? 3600 : 86400;
    let end: number;
    if (trigger.config.endsAt) {
      end = Math.floor(new Date(trigger.config.endsAt).getTime() / 1000);
    } else if (trigger.config.occurrences) {
      end = start + intervalSeconds * trigger.config.occurrences;
    } else {
      end = start + 60 * 60 * 24 * 30;
    }
    return {
      kind: "streamer",
      asset: action.config.asset,
      recipient: action.config.recipient,
      ratePerSecondStroops: action.config.amountStroops,
      startTs: start,
      endTs: end,
    };
  }

  if (templateKind === TemplateKind.CONDITIONAL) {
    if (action.type !== "pay") {
      throw new Error("Conditional requires a pay action");
    }
    return {
      kind: "conditional",
      asset: action.config.asset,
      recipient: action.config.recipient,
      amountStroops: action.config.amountStroops,
      condition: condition?.config ?? null,
    };
  }

  throw new Error(`Unhandled template kind: ${templateKind}`);
}
