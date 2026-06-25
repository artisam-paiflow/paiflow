import { TemplateKind } from "@prisma/client";
import type {
  ActionNode,
  Asset,
  ContractActionNode,
  FlowGraph,
  FlowNode,
  LogicNode,
  TriggerNode,
} from "./schema";
import {
  isAction,
  isLogic,
  isTrigger,
  isContractAction,
  isPendingAddress,
  pctToBps,
  sourceAmountStroops,
  TOTAL_BPS,
} from "./schema";

export type PipelineRecipient = {
  address: string;
  bps: number;
  amount: string;
};

export type SplitterParams = {
  kind: "splitter";
  asset: Asset;
  recipients: PipelineRecipient[];
  minAmountStroops?: string;
};

export type StreamerParams = {
  kind: "streamer";
  asset: Asset;
  recipients: PipelineRecipient[];
  amountPerIntervalStroops: string;
  intervalSeconds: number;
  startTs: number;
  endTs: number;
  pauseAllowed: boolean;
  retrieveAllowed: boolean;
};

export type ConditionalParams = {
  kind: "conditional";
  asset: Asset;
  recipients: PipelineRecipient[];
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
  recipients: PipelineRecipient[];
  minAmountStroops: string;
  nextStepNodeIds: string[];
};

export type StreamerNodeParams = {
  kind: "streamer";
  asset: Asset;
  recipients: PipelineRecipient[];
  amountPerIntervalStroops: string;
  intervalSeconds: number;
  startTs: number;
  endTs: number;
  pauseAllowed: boolean;
  retrieveAllowed: boolean;
};

export type ConditionalNodeParams = {
  kind: "conditional";
  asset: Asset;
  recipients: PipelineRecipient[];
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
  mode: "after" | "before";
  nextStepNodeIds: string[];
  relayer?: string;
};

export type WebhookTriggerNodeParams = {
  kind: "webhook_trigger";
  asset: Asset;
  relayer: string;
  nextStepNodeIds: string[];
};

export type SubscriptionTriggerNodeParams = {
  kind: "subscription_trigger";
  asset: Asset;
  subscriber: string;
  amountPerPeriodStroops: string;
  relayer?: string;
  startTs: number;
  endTs: number;
  intervalSeconds: number;
  nextStepNodeIds: string[];
};

export type PayrollTriggerNodeParams = {
  kind: "payroll_trigger";
  asset: Asset;
  employer: string;
  amountPerPeriodStroops: string;
  recipients: PipelineRecipient[];
  relayer?: string;
  startTs: number;
  endTs: number;
  intervalSeconds: number;
  nextStepNodeIds: string[];
};

export type OracleTriggerNodeParams = {
  kind: "oracle_trigger";
  asset: Asset;
  threshold: string;
  nextStepNodeIds: string[];
};

export type MultisigNodeParams = {
  kind: "multisig";
  asset: Asset;
  signers: Array<{ address: string; bps: number }>;
  threshold: number;
  nextStepNodeIds: string[];
};

export type SwapperNodeParams = {
  kind: "swapper";
  assetIn: Asset;
  assetOut: Asset;
  rateBps: number;
  nextStepNodeIds: string[];
};

export type YieldNodeParams = {
  kind: "yield";
  asset: Asset;
  vault: string;
  nextStepNodeIds: string[];
};

export type PayerNodeParams = {
  kind: "payer";
  asset: Asset;
  recipient: string;
  amountStroops: string;
  mode: "fixed" | "percentage";
  percentageBps?: number;
  nextStepNodeIds: string[];
};

// ── Dev-mode (mutable / parameterized) node params ──────────────────────────
// These map to the PAYER_DEV / SPLITTER_DEV / SUBSCRIPTION_DEV contracts whose
// recipient / subscriber may be left blank (`undefined`) at deploy time and
// filled later via the API. All carry the relayer so the backend key can both
// trigger execution and mutate the params.

export type PayerDevNodeParams = {
  kind: "payer_dev";
  asset: Asset;
  recipient?: string; // undefined => blank, configure via API
  amountStroops: string;
  mode: "fixed" | "percentage";
  percentageBps?: number;
  relayer?: string;
  nextStepNodeIds: string[];
};

export type SplitterDevNodeParams = {
  kind: "splitter_dev";
  asset: Asset;
  recipients: PipelineRecipient[]; // may be empty => blank, configure via API
  minAmountStroops: string;
  relayer?: string;
  nextStepNodeIds: string[];
};

export type SubscriptionDevTriggerNodeParams = {
  kind: "subscription_dev_trigger";
  asset: Asset;
  subscriber?: string; // undefined => blank, configure via API
  amountPerPeriodStroops: string;
  relayer?: string;
  startTs: number;
  endTs: number;
  intervalSeconds: number;
  nextStepNodeIds: string[];
};

export type CashOutDevNodeParams = {
  kind: "cash_out_dev";
  asset: Asset;
  // Bank destination — blank ("") at deploy time, filled via the API later.
  accountName: string;
  accountNumber: string;
  bankCode: string;
  treasury: string; // off-ramp treasury the asset is sunk to
  relayer?: string;
  nextStepNodeIds: string[]; // always empty — cash_out is terminal
};

export type CashOutNodeParams = {
  kind: "cash_out";
  asset: Asset;
  // Bank destination is immutable after deploy; validation requires it at design time.
  accountName: string;
  accountNumber: string;
  bankCode: string;
  treasury: string;
  relayer?: string;
  nextStepNodeIds: string[]; // always empty — cash_out is terminal
};

export type PipelineNodeParams =
  | DepositTriggerNodeParams
  | SplitterNodeParams
  | StreamerNodeParams
  | ConditionalNodeParams
  | RouterNodeParams
  | TimelockNodeParams
  | WebhookTriggerNodeParams
  | SubscriptionTriggerNodeParams
  | PayrollTriggerNodeParams
  | OracleTriggerNodeParams
  | MultisigNodeParams
  | SwapperNodeParams
  | YieldNodeParams
  | PayerNodeParams
  | PayerDevNodeParams
  | SplitterDevNodeParams
  | SubscriptionDevTriggerNodeParams
  | CashOutDevNodeParams
  | CashOutNodeParams;

export type PipelineNode = {
  nodeId: string;
  templateKind: TemplateKind;
  params: PipelineNodeParams;
};

function getAsset(action: ContractActionNode): Asset {
  if (action.type === "swap") return action.config.assetIn;
  if (action.type === "yield") return action.config.asset;
  return action.config.asset;
}

function toRecipients(action: ContractActionNode): PipelineRecipient[] {
  if (action.type === "split") {
    return action.config.recipients.map((r) => ({
      address: r.address,
      bps: r.mode === "percentage" ? r.bps : 0,
      amount: r.mode === "fixed" ? r.amountStroops : "0",
    }));
  }
  if (action.type === "pay") {
    return [{ address: action.config.recipient, bps: TOTAL_BPS, amount: "0" }];
  }
  return [];
}

/**
 * Payroll stores the fixed salary amount per recipient in the contract, so the
 * amount field must be populated for both split and pay actions.
 */
function toPayrollRecipients(action: ContractActionNode): PipelineRecipient[] {
  if (action.type === "split") {
    return action.config.recipients.map((r) => ({
      address: r.address,
      bps: 0,
      amount: r.mode === "fixed" ? r.amountStroops : "0",
    }));
  }
  if (action.type === "pay") {
    return [
      {
        address: action.config.recipient,
        bps: 0,
        amount: action.config.amountStroops ?? "0",
      },
    ];
  }
  return [];
}

function getChildren(graph: FlowGraph): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const n of graph.nodes) children.set(n.id, []);
  for (const e of graph.edges) {
    children.get(e.source)!.push(e.target);
  }
  return children;
}

function getPipelineChildren(graph: FlowGraph): Map<string, string[]> {
  const emailIds = new Set(graph.nodes.filter((n) => n.type === "email_notify").map((n) => n.id));
  const children = new Map<string, string[]>();
  for (const n of graph.nodes) children.set(n.id, []);
  for (const e of graph.edges) {
    // Email notify nodes are off-chain decorators; they should never be wired
    // into the on-chain pipeline as next steps.
    if (emailIds.has(e.source) || emailIds.has(e.target)) continue;
    children.get(e.source)!.push(e.target);
  }
  return children;
}

function intervalToSeconds(
  amount: number,
  unit: "minute" | "hour" | "day" | "week" | "month",
): number {
  const base =
    unit === "minute"
      ? 60
      : unit === "hour"
        ? 60 * 60
        : unit === "day"
          ? 60 * 60 * 24
          : unit === "week"
            ? 60 * 60 * 24 * 7
            : 60 * 60 * 24 * 30; // month ≈ 30 days
  return amount * base;
}

function computeStreamerEndTs(
  trigger: Extract<FlowNode, { type: "on_schedule" }>,
  startTs: number,
): number {
  // Backward compat: old flows used `interval` string with implicit amount of 1
  const amount =
    (trigger.config as { intervalAmount?: number; interval?: string }).intervalAmount ?? 1;
  const unit = ((trigger.config as { intervalUnit?: string; interval?: string }).intervalUnit ??
    (trigger.config as { interval?: string }).interval ??
    "hour") as "minute" | "hour" | "day" | "week" | "month";

  if (trigger.config.endsAt) {
    return Math.floor(new Date(trigger.config.endsAt).getTime() / 1000);
  }
  if (trigger.config.occurrences) {
    return startTs + trigger.config.occurrences * intervalToSeconds(amount, unit);
  }
  return startTs + 60 * 60 * 24 * 30; // 30-day default
}

function scheduleIntervalSeconds(trigger: Extract<FlowNode, { type: "on_schedule" }>): number {
  const intervalAmount =
    (trigger.config as { intervalAmount?: number; interval?: string }).intervalAmount ?? 1;
  const intervalUnit = ((trigger.config as { intervalUnit?: string; interval?: string })
    .intervalUnit ??
    (trigger.config as { interval?: string }).interval ??
    "hour") as "minute" | "hour" | "day" | "week" | "month";
  return intervalToSeconds(intervalAmount, intervalUnit);
}

function streamerAmountPerInterval(
  action: ActionNode,
  _trigger: FlowNode,
  intervalSeconds: number,
): string {
  if (action.type === "pay") {
    return action.config.amountStroops ?? "1";
  }
  if (action.type === "split") {
    if (action.config.amountPerIntervalStroops) {
      return action.config.amountPerIntervalStroops;
    }
    // Backward compat: convert deprecated rate-per-second to amount-per-interval.
    if (action.config.ratePerSecondStroops) {
      return String(BigInt(action.config.ratePerSecondStroops) * BigInt(intervalSeconds));
    }
    return "1";
  }
  return "1";
}

/**
 * Convert a validated flow graph into a pipeline of decoupled contract
 * deployments.  Each graph node becomes one on-chain contract.  Parent / child
 * relationships are expressed as nodeId references so the deploy layer can
 * wire deterministic addresses later.
 */
export function flowToPipeline(
  graph: FlowGraph,
  relayerAddress?: string,
  treasuryAddress?: string,
): PipelineNode[] {
  const trigger = graph.nodes.find(isTrigger)!;
  const actions = graph.nodes.filter(isAction);
  const contractActions = actions.filter(isContractAction);
  const conditions = graph.nodes.filter(isLogic);
  const children = getPipelineChildren(graph);
  const devMode = graph.devMode === true;
  const pipeline: PipelineNode[] = [];

  // ── schedule-like flows (on_schedule, subscription, payroll) ─────────
  if (
    trigger.type === "on_schedule" ||
    trigger.type === "subscription" ||
    trigger.type === "payroll"
  ) {
    const action = contractActions[0]!;
    const asset = getAsset(action);

    const nowSeconds = Math.floor(Date.now() / 1000);
    // If the configured start time is already in the past (common when a flow
    // was created minutes ago and is only being deployed now), start the stream
    // at the current time so short streams aren't already over on deploy.
    const start =
      trigger.type === "on_schedule"
        ? Math.max(nowSeconds, Math.floor(new Date(trigger.config.startsAt).getTime() / 1000))
        : nowSeconds;

    let end: number;
    let intervalSeconds: number;

    if (trigger.type === "subscription" || trigger.type === "payroll") {
      const cfg = trigger.config as {
        intervalAmount: number;
        intervalUnit: "minute" | "hour" | "day" | "week" | "month";
        endsAt?: string;
        occurrences?: number;
      };
      intervalSeconds = intervalToSeconds(cfg.intervalAmount, cfg.intervalUnit);
      if (cfg.endsAt) {
        end = Math.floor(new Date(cfg.endsAt).getTime() / 1000);
      } else if (cfg.occurrences) {
        end = start + cfg.occurrences * intervalSeconds;
      } else {
        end = start + 60 * 60 * 24 * 30;
      }
    } else {
      end = computeStreamerEndTs(trigger, start);
      intervalSeconds = scheduleIntervalSeconds(trigger);
    }

    if (trigger.type === "subscription") {
      if (devMode) {
        pipeline.push({
          nodeId: trigger.id,
          templateKind: TemplateKind.SUBSCRIPTION_DEV,
          params: {
            kind: "subscription_dev_trigger",
            asset: trigger.config.asset,
            subscriber: isPendingAddress(trigger.config.subscriber)
              ? undefined
              : trigger.config.subscriber,
            amountPerPeriodStroops: trigger.config.amountPerPeriodStroops,
            relayer: relayerAddress,
            startTs: start,
            endTs: end,
            intervalSeconds,
            nextStepNodeIds: children.get(trigger.id) ?? [],
          },
        });
      } else {
        pipeline.push({
          nodeId: trigger.id,
          templateKind: TemplateKind.SUBSCRIPTION,
          params: {
            kind: "subscription_trigger",
            asset: trigger.config.asset,
            subscriber: trigger.config.subscriber,
            amountPerPeriodStroops: trigger.config.amountPerPeriodStroops,
            relayer: relayerAddress,
            startTs: start,
            endTs: end,
            intervalSeconds,
            nextStepNodeIds: children.get(trigger.id) ?? [],
          },
        });
      }

      // Subscription pulls are forwarded to standard action contracts that
      // implement receive_and_forward (payer, splitter, swapper, yield).
      const seenActions = new Set<string>();
      const actionQueue: ContractActionNode[] = [action];
      while (actionQueue.length > 0) {
        const current = actionQueue.shift()!;
        if (seenActions.has(current.id)) continue;
        seenActions.add(current.id);
        pipeline.push(
          contractActionToPipelineNode(
            current,
            trigger,
            children,
            devMode,
            relayerAddress,
            treasuryAddress,
          ),
        );
        for (const childId of children.get(current.id) ?? []) {
          const childNode = graph.nodes.find((n) => n.id === childId);
          if (childNode && isContractAction(childNode) && !seenActions.has(childNode.id)) {
            actionQueue.push(childNode);
          }
        }
      }
      return pipeline;
    }

    if (trigger.type === "payroll") {
      const recipients = toPayrollRecipients(action);
      const amountPerPeriod = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n).toString();

      if (devMode) {
        // Decompose payroll into the dev preset: SUBSCRIPTION_DEV pulls from the
        // employer each period, then forwards atomically to SPLITTER_DEV which
        // distributes the fixed salaries in the same transaction.
        pipeline.push({
          nodeId: trigger.id,
          templateKind: TemplateKind.SUBSCRIPTION_DEV,
          params: {
            kind: "subscription_dev_trigger",
            asset: trigger.config.asset,
            subscriber: isPendingAddress(trigger.config.employer)
              ? undefined
              : trigger.config.employer,
            amountPerPeriodStroops: amountPerPeriod,
            relayer: relayerAddress,
            startTs: start,
            endTs: end,
            intervalSeconds,
            nextStepNodeIds: children.get(trigger.id) ?? [],
          },
        });

        const seenActions = new Set<string>();
        const actionQueue: ContractActionNode[] = [action];
        while (actionQueue.length > 0) {
          const current = actionQueue.shift()!;
          if (seenActions.has(current.id)) continue;
          seenActions.add(current.id);
          pipeline.push(
            contractActionToPipelineNode(
              current,
              trigger,
              children,
              true,
              relayerAddress,
              treasuryAddress,
            ),
          );
          for (const childId of children.get(current.id) ?? []) {
            const childNode = graph.nodes.find((n) => n.id === childId);
            if (childNode && isContractAction(childNode) && !seenActions.has(childNode.id)) {
              actionQueue.push(childNode);
            }
          }
        }
        return pipeline;
      }

      pipeline.push({
        nodeId: trigger.id,
        templateKind: TemplateKind.PAYROLL,
        params: {
          kind: "payroll_trigger",
          asset: trigger.config.asset,
          employer: trigger.config.employer,
          amountPerPeriodStroops: amountPerPeriod,
          recipients,
          relayer: relayerAddress,
          startTs: start,
          endTs: end,
          intervalSeconds,
          nextStepNodeIds: [],
        },
      });
      return pipeline;
    }

    // on_schedule flows use the streamer contract as the action because the
    // streamer itself drives the release schedule.
    const amountPerInterval = streamerAmountPerInterval(action, trigger, intervalSeconds);
    pipeline.push({
      nodeId: action.id,
      templateKind: TemplateKind.STREAMER,
      params: {
        kind: "streamer",
        asset,
        recipients: toRecipients(action),
        amountPerIntervalStroops: amountPerInterval,
        intervalSeconds,
        startTs: start,
        endTs: end,
        pauseAllowed: trigger.config.pauseAllowed ?? true,
        retrieveAllowed: trigger.config.retrieveAllowed ?? false,
      },
    });
    return pipeline;
  }

  // ── receive-like flows (on_receive, webhook, oracle) ─────────────────
  const action = contractActions[0]!;
  const asset = action.type === "swap" ? action.config.assetIn : getAsset(action);
  const recipients = toRecipients(action);

  // Trigger
  if (trigger.type === "webhook") {
    pipeline.push({
      nodeId: trigger.id,
      templateKind: TemplateKind.WEBHOOK,
      params: {
        kind: "webhook_trigger",
        asset: trigger.config.asset,
        relayer: trigger.config.relayer,
        nextStepNodeIds: children.get(trigger.id) ?? [],
      },
    });
  } else if (trigger.type === "web2_webhook") {
    pipeline.push({
      nodeId: trigger.id,
      templateKind: TemplateKind.WEBHOOK,
      params: {
        kind: "webhook_trigger",
        asset: trigger.config.asset,
        relayer: relayerAddress ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH2",
        nextStepNodeIds: children.get(trigger.id) ?? [],
      },
    });
  } else if (trigger.type === "oracle") {
    pipeline.push({
      nodeId: trigger.id,
      templateKind: TemplateKind.ORACLE,
      params: {
        kind: "oracle_trigger",
        asset: trigger.config.asset,
        threshold: trigger.config.threshold,
        nextStepNodeIds: children.get(trigger.id) ?? [],
      },
    });
  } else {
    pipeline.push({
      nodeId: trigger.id,
      templateKind: TemplateKind.DEPOSIT_TRIGGER,
      params: {
        kind: "deposit_trigger",
        asset,
        nextStepNodeIds: children.get(trigger.id) ?? [],
      },
    });
  }

  // Conditions
  let terminal = false;
  for (const cond of conditions) {
    if (cond.config.kind === "time_after" || cond.config.kind === "time_before") {
      const ts = Math.floor(new Date(cond.config.at).getTime() / 1000);
      pipeline.push({
        nodeId: cond.id,
        templateKind: TemplateKind.TIMELOCK,
        params: {
          kind: "timelock",
          asset,
          unlockTime: ts,
          mode: cond.config.kind === "time_after" ? "after" : "before",
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
        action.type === "pay"
          ? (action.config.amountStroops ?? "0")
          : (sourceAmountStroops(graph) ?? "0");
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
      terminal = true;
    } else if (cond.config.kind === "multisig") {
      pipeline.push({
        nodeId: cond.id,
        templateKind: TemplateKind.MULTISIG,
        params: {
          kind: "multisig",
          asset,
          signers: cond.config.signers.map((s) => ({ address: s, bps: 0 })),
          threshold: cond.config.threshold,
          nextStepNodeIds: children.get(cond.id) ?? [],
        },
      });
    }
  }

  // Action(s)
  if (!terminal) {
    const seenActions = new Set<string>();
    const actionQueue: ContractActionNode[] = [action];

    while (actionQueue.length > 0) {
      const current = actionQueue.shift()!;
      if (seenActions.has(current.id)) continue;
      seenActions.add(current.id);

      pipeline.push(
        contractActionToPipelineNode(
          current,
          trigger,
          children,
          devMode,
          relayerAddress,
          treasuryAddress,
        ),
      );

      for (const childId of children.get(current.id) ?? []) {
        const childNode = graph.nodes.find((n) => n.id === childId);
        if (childNode && isContractAction(childNode) && !seenActions.has(childNode.id)) {
          actionQueue.push(childNode);
        }
      }
    }
  }

  return pipeline;
}

function contractActionToPipelineNode(
  action: ContractActionNode,
  trigger: TriggerNode,
  children: Map<string, string[]>,
  devMode = false,
  relayerAddress?: string,
  treasuryAddress?: string,
): PipelineNode {
  const nextStepNodeIds = children.get(action.id) ?? [];

  switch (action.type) {
    case "cash_out": {
      // Dev mode: mutable CASH_OUT_DEV allows blank bank details filled via API.
      // Non-dev: immutable CASH_OUT bakes the bank destination into the contract.
      if (devMode) {
        return {
          nodeId: action.id,
          templateKind: TemplateKind.CASH_OUT_DEV,
          params: {
            kind: "cash_out_dev",
            asset: action.config.asset,
            accountName: action.config.accountName ?? "",
            accountNumber: action.config.accountNumber ?? "",
            bankCode: action.config.bankCode ?? "",
            treasury: treasuryAddress ?? relayerAddress ?? "",
            relayer: relayerAddress,
            nextStepNodeIds: [],
          },
        };
      }
      return {
        nodeId: action.id,
        templateKind: TemplateKind.CASH_OUT,
        params: {
          kind: "cash_out",
          asset: action.config.asset,
          accountName: action.config.accountName ?? "",
          accountNumber: action.config.accountNumber ?? "",
          bankCode: action.config.bankCode ?? "",
          treasury: treasuryAddress ?? relayerAddress ?? "",
          relayer: relayerAddress,
          nextStepNodeIds: [],
        },
      };
    }
    case "swap":
      return {
        nodeId: action.id,
        templateKind: TemplateKind.SWAPPER,
        params: {
          kind: "swapper",
          assetIn: action.config.assetIn,
          assetOut: action.config.assetOut,
          rateBps: action.config.rateBps,
          nextStepNodeIds,
        },
      };
    case "yield":
      return {
        nodeId: action.id,
        templateKind: TemplateKind.YIELD,
        params: {
          kind: "yield",
          asset: action.config.asset,
          vault: action.config.vault,
          nextStepNodeIds,
        },
      };
    case "pay": {
      // Dev variant: mutable recipient/amount, blank-capable.
      if (devMode) {
        const recipient = isPendingAddress(action.config.recipient)
          ? undefined
          : action.config.recipient;
        const devBase = {
          nodeId: action.id,
          templateKind: TemplateKind.PAYER_DEV,
          params: {
            kind: "payer_dev" as const,
            asset: getAsset(action),
            recipient,
            relayer: relayerAddress,
            nextStepNodeIds,
          },
        };
        if (action.config.fullAmount) {
          return {
            ...devBase,
            params: {
              ...devBase.params,
              amountStroops: "0",
              mode: "percentage" as const,
              percentageBps: 10_000,
            },
          };
        }
        if (action.config.mode === "percentage") {
          return {
            ...devBase,
            params: {
              ...devBase.params,
              amountStroops: "0",
              mode: "percentage" as const,
              percentageBps: pctToBps(action.config.percentage ?? 0),
            },
          };
        }
        return {
          ...devBase,
          params: {
            ...devBase.params,
            amountStroops: action.config.amountStroops ?? "0",
            mode: "fixed" as const,
          },
        };
      }

      const base = {
        nodeId: action.id,
        templateKind: TemplateKind.PAYER,
        params: {
          kind: "payer" as const,
          asset: getAsset(action),
          recipient: action.config.recipient,
          nextStepNodeIds,
        },
      };

      if (action.config.fullAmount) {
        return {
          ...base,
          params: {
            ...base.params,
            amountStroops: "0",
            mode: "percentage" as const,
            percentageBps: 10_000,
          },
        };
      }

      if (action.config.mode === "percentage") {
        return {
          ...base,
          params: {
            ...base.params,
            amountStroops: "0",
            mode: "percentage" as const,
            percentageBps: pctToBps(action.config.percentage ?? 0),
          },
        };
      }

      return {
        ...base,
        params: {
          ...base.params,
          amountStroops: action.config.amountStroops ?? "0",
          mode: "fixed" as const,
        },
      };
    }
    case "split": {
      const minAmountStroops =
        trigger.type === "on_receive" ? (trigger.config.minAmountStroops ?? "0") : "0";

      // Dev variant: mutable recipients, blank-capable. Pending recipients are
      // dropped so the contract deploys "not yet configured" and is filled via
      // the API; pre-filled (concrete) recipients must still be valid.
      if (devMode) {
        const recipients = toRecipients(action).filter((r) => !isPendingAddress(r.address));
        return {
          nodeId: action.id,
          templateKind: TemplateKind.SPLITTER_DEV,
          params: {
            kind: "splitter_dev",
            asset: getAsset(action),
            recipients,
            minAmountStroops,
            relayer: relayerAddress,
            nextStepNodeIds,
          },
        };
      }

      return {
        nodeId: action.id,
        templateKind: TemplateKind.SPLITTER,
        params: {
          kind: "splitter",
          asset: getAsset(action),
          recipients: toRecipients(action),
          minAmountStroops,
          nextStepNodeIds,
        },
      };
    }
  }
}

export function getStreamerPreviewFromPipeline(pipeline: PipelineNode[]) {
  const streamer = pipeline.find((n) => n.templateKind === TemplateKind.STREAMER);
  if (!streamer || streamer.params.kind !== "streamer") return null;
  const { amountPerIntervalStroops, intervalSeconds, startTs, endTs } = streamer.params;
  const durationSecs = endTs - startTs;
  const intervals = Math.floor(durationSecs / intervalSeconds);
  const totalStroops = (BigInt(amountPerIntervalStroops) * BigInt(intervals)).toString();
  return { amountPerIntervalStroops, intervalSeconds, startTs, endTs, durationSecs, totalStroops };
}

export function getSubscriptionPreviewFromPipeline(pipeline: PipelineNode[]) {
  const sub = pipeline.find((n) => n.templateKind === TemplateKind.SUBSCRIPTION);
  if (!sub || sub.params.kind !== "subscription_trigger") return null;
  const { amountPerPeriodStroops, intervalSeconds, startTs, endTs } = sub.params;
  const durationSecs = endTs - startTs;
  const intervals = Math.floor(durationSecs / intervalSeconds);
  const totalStroops = (BigInt(amountPerPeriodStroops) * BigInt(intervals)).toString();
  return { amountPerPeriodStroops, intervalSeconds, startTs, endTs, durationSecs, totalStroops };
}

export function getPayrollPreviewFromPipeline(pipeline: PipelineNode[]) {
  const payroll = pipeline.find((n) => n.templateKind === TemplateKind.PAYROLL);
  if (payroll && payroll.params.kind === "payroll_trigger") {
    const { amountPerPeriodStroops, recipients, intervalSeconds, startTs, endTs } = payroll.params;
    const durationSecs = endTs - startTs;
    const intervals = Math.floor(durationSecs / intervalSeconds);
    const totalStroops = (BigInt(amountPerPeriodStroops) * BigInt(intervals)).toString();
    return {
      amountPerPeriodStroops,
      recipients,
      intervalSeconds,
      startTs,
      endTs,
      durationSecs,
      totalStroops,
    };
  }

  // Dev-mode decomposition: SUBSCRIPTION_DEV (employer pull) → SPLITTER_DEV (distribution).
  const sub = pipeline.find((n) => n.templateKind === TemplateKind.SUBSCRIPTION_DEV);
  const split = pipeline.find((n) => n.templateKind === TemplateKind.SPLITTER_DEV);
  if (
    sub &&
    sub.params.kind === "subscription_dev_trigger" &&
    split &&
    split.params.kind === "splitter_dev"
  ) {
    const { amountPerPeriodStroops, intervalSeconds, startTs, endTs } = sub.params;
    const durationSecs = endTs - startTs;
    const intervals = Math.floor(durationSecs / intervalSeconds);
    const totalStroops = (BigInt(amountPerPeriodStroops) * BigInt(intervals)).toString();
    const recipients = split.params.recipients.map((r) => ({
      address: r.address,
      bps: r.bps,
      amount: r.amount,
    }));
    return {
      amountPerPeriodStroops,
      recipients,
      intervalSeconds,
      startTs,
      endTs,
      durationSecs,
      totalStroops,
    };
  }

  return null;
}

/**
 * @deprecated Use {@link flowToPipeline} for new code.  This helper is kept
 * for the streamer preview page and existing tests that assert on monolithic
 * contract params.
 */
export function flowToParams(graph: FlowGraph, templateKind: TemplateKind): ContractParams {
  const trigger = graph.nodes.find(isTrigger)!;
  const action = graph.nodes.find(isContractAction)!;
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
    const nowSeconds = Math.floor(Date.now() / 1000);
    const start = Math.max(
      nowSeconds,
      Math.floor(new Date(trigger.config.startsAt).getTime() / 1000),
    );
    const end = computeStreamerEndTs(trigger, start);
    const intervalSeconds = scheduleIntervalSeconds(trigger);
    const amountPerInterval = streamerAmountPerInterval(action, trigger, intervalSeconds);
    return {
      kind: "streamer",
      asset: getAsset(action),
      recipients,
      amountPerIntervalStroops: amountPerInterval,
      intervalSeconds,
      startTs: start,
      endTs: end,
      pauseAllowed: trigger.config.pauseAllowed ?? true,
      retrieveAllowed: trigger.config.retrieveAllowed ?? false,
    };
  }

  if (templateKind === TemplateKind.CONDITIONAL) {
    const amount =
      action.type === "pay"
        ? (action.config.amountStroops ?? "0")
        : (sourceAmountStroops(graph) ?? "0");
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
