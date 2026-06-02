import { TemplateKind } from "@prisma/client";
import type { Asset, ActionNode, FlowGraph, FlowNode, LogicNode } from "./schema";
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

export type DepositTriggerNodeParams = {
  kind: "deposit_trigger";
  asset: Asset;
  nextStepNodeIds: string[];
};

export type SplitterNodeParams = {
  kind: "splitter";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  minAmountStroops: string;
};

export type StreamerNodeParams = {
  kind: "streamer";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  ratePerSecondStroops: string;
  startTs: number;
  endTs: number;
};

export type ConditionalNodeParams = {
  kind: "conditional";
  asset: Asset;
  recipients: Array<{ address: string; bps: number }>;
  amountStroops: string;
  condition: unknown;
  nextStepNodeIds: string[];
};

export type RouterNodeParams = {
  kind: "router";
  asset: Asset;
  threshold: string;
  pathANodeIds: string[];
  pathBNodeIds: string[];
};

export type TimelockNodeParams = {
  kind: "timelock";
  asset: Asset;
  unlockTime: number;
  nextStepNodeIds: string[];
};

export type PipelineNodeParams =
  | DepositTriggerNodeParams
  | SplitterNodeParams
  | StreamerNodeParams
  | ConditionalNodeParams
  | RouterNodeParams
  | TimelockNodeParams;

export type PipelineNode = {
  nodeId: string;
  templateKind: TemplateKind;
  params: PipelineNodeParams;
};

function getAsset(action: ActionNode): Asset {
  return action.config.asset;
}

function toRecipients(action: ActionNode): Array<{ address: string; bps: number }> {
  if (action.type === "split") {
    return action.config.recipients.map((r) => ({ address: r.address, bps: r.bps }));
  }
  return [{ address: action.config.recipient, bps: TOTAL_BPS }];
}

function getChildren(graph: FlowGraph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const n of graph.nodes) children.set(n.id, []);
  for (const e of graph.edges) {
    children.get(e.source)!.push(e.target);
  }
  return children;
}

/**
 * Convert a validated flow graph into a pipeline of decoupled contract
 * deployments.  Each graph node becomes one on-chain contract.  Parent / child
 * relationships are expressed as nodeId references so the deploy layer can
 * wire deterministic addresses later.
 */
export function flowToPipeline(graph: FlowGraph): PipelineNode[] {
  const trigger = graph.nodes.find(isTrigger)!;
  const actions = graph.nodes.filter(isAction);
  const conditions = graph.nodes.filter(isLogic);
  const children = getChildren(graph);
  const pipeline: PipelineNode[] = [];

  // ── on_schedule flows ────────────────────────────────────────────────
  // There is no schedule-trigger contract yet; the streamer acts as the
  // entire standalone workflow.
  if (trigger.type === "on_schedule") {
    const action = actions[0]!;
    const recipients = toRecipients(action);
    const asset = getAsset(action);
    const start = Math.floor(new Date(trigger.config.startsAt).getTime() / 1000);
    const end = trigger.config.endsAt
      ? Math.floor(new Date(trigger.config.endsAt).getTime() / 1000)
      : start + 60 * 60 * 24 * 30;
    const rate =
      action.type === "pay"
        ? action.config.amountStroops
        : (action.config.ratePerSecondStroops ?? "1");
    pipeline.push({
      nodeId: trigger.id,
      templateKind: TemplateKind.STREAMER,
      params: {
        kind: "streamer",
        asset,
        recipients,
        ratePerSecondStroops: rate,
        startTs: start,
        endTs: end,
      },
    });
    return pipeline;
  }

  // ── on_receive flows ─────────────────────────────────────────────────
  const action = actions[0]!;
  const asset = getAsset(action);
  const recipients = toRecipients(action);

  // Trigger
  pipeline.push({
    nodeId: trigger.id,
    templateKind: TemplateKind.DEPOSIT_TRIGGER,
    params: {
      kind: "deposit_trigger",
      asset,
      nextStepNodeIds: children.get(trigger.id) ?? [],
    },
  });

  // Conditions (0 or 1 in current builder)
  let terminal = false;
  for (const cond of conditions) {
    if (cond.config.kind === "time_after") {
      const ts = Math.floor(new Date(cond.config.at).getTime() / 1000);
      pipeline.push({
        nodeId: cond.id,
        templateKind: TemplateKind.TIMELOCK,
        params: {
          kind: "timelock",
          asset,
          unlockTime: ts,
          nextStepNodeIds: children.get(cond.id) ?? [],
        },
      });
    } else if (cond.config.kind === "amount_gt" || cond.config.kind === "amount_lt") {
      const childIds = children.get(cond.id) ?? [];
      const pathA = cond.config.kind === "amount_gt" ? childIds : [];
      const pathB = cond.config.kind === "amount_lt" ? childIds : [];
      pipeline.push({
        nodeId: cond.id,
        templateKind: TemplateKind.ROUTER,
        params: {
          kind: "router",
          asset,
          threshold: cond.config.amountStroops,
          pathANodeIds: pathA,
          pathBNodeIds: pathB,
        },
      });
    } else if (cond.config.kind === "oracle_gte") {
      const amount =
        action.type === "pay" ? action.config.amountStroops : (sourceAmountStroops(graph) ?? "0");
      pipeline.push({
        nodeId: cond.id,
        templateKind: TemplateKind.CONDITIONAL,
        params: {
          kind: "conditional",
          asset,
          recipients,
          amountStroops: amount,
          condition: cond.config,
          nextStepNodeIds: children.get(cond.id) ?? [],
        },
      });
      terminal = true; // Conditional pays out directly; no splitter needed
    }
  }

  // Action (only when the last condition is not a terminal conditional)
  if (!terminal) {
    const minAmountStroops = trigger.config.minAmountStroops ?? "0";
    pipeline.push({
      nodeId: action.id,
      templateKind: TemplateKind.SPLITTER,
      params: {
        kind: "splitter",
        asset,
        recipients,
        minAmountStroops,
      },
    });
  }

  return pipeline;
}

export function getStreamerPreviewFromPipeline(pipeline: PipelineNode[]) {
  const streamer = pipeline.find((n) => n.templateKind === TemplateKind.STREAMER);
  if (!streamer || streamer.params.kind !== "streamer") return null;
  const { ratePerSecondStroops, startTs, endTs } = streamer.params;
  const durationSecs = endTs - startTs;
  const totalStroops = (BigInt(ratePerSecondStroops) * BigInt(durationSecs)).toString();
  return { ratePerSecondStroops, startTs, endTs, durationSecs, totalStroops };
}

/**
 * @deprecated Use {@link flowToPipeline} for new code.  This helper is kept
 * for the streamer preview page and existing tests that assert on monolithic
 * contract params.
 */
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
