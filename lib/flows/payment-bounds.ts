import type { ValidationIssue } from "./issue";
import { I128_MAX } from "./primitives";
import { subscriptionAmountPerPeriodStroops, type FlowGraph } from "./schema";
import type { PipelineNode } from "./to-params";

function inAmountRange(amount: string): boolean {
  return /^\d{1,39}$/.test(amount) && BigInt(amount) <= I128_MAX;
}

function rangeIssue(path: string): ValidationIssue {
  return {
    path,
    message: "Payment amount exceeds the supported i128 range",
    friendlyMessage: "Reduce this amount so the payment can be represented on chain.",
  };
}

/** Deployment checks only: incomplete amounts must remain saveable as drafts. */
export function paymentAmountIssues(graph: FlowGraph): ValidationIssue[] {
  // Mutable contract improvements and payroll are separate workstreams (#795).
  if (graph.devMode || graph.nodes.some((n) => n.type === "payroll")) return [];
  const issues: ValidationIssue[] = [];
  const scheduled = graph.nodes.some((n) => n.type === "on_schedule");
  for (const node of graph.nodes) {
    const path = `nodes.${node.id}.config`;
    if (node.type === "on_receive") {
      const amount = node.config.minAmountStroops;
      if (amount && !inAmountRange(amount)) issues.push(rangeIssue(`${path}.minAmountStroops`));
    } else if (node.type === "subscription") {
      const amount = subscriptionAmountPerPeriodStroops(graph);
      if (amount && !inAmountRange(amount)) {
        issues.push(rangeIssue(`${path}.amountPerPeriodStroops`));
      }
    } else if (node.type === "pay") {
      const c = node.config;
      if (
        c.mode === "fixed" &&
        !c.fullAmount &&
        c.amountStroops &&
        !inAmountRange(c.amountStroops)
      ) {
        issues.push(rangeIssue(`${path}.amountStroops`));
      }
    } else if (node.type === "split") {
      const fixed = node.config.recipients.filter((r) => r.mode === "fixed");
      for (const [index, r] of node.config.recipients.entries()) {
        if (r.mode === "fixed" && !inAmountRange(r.amountStroops)) {
          issues.push(rangeIssue(`${path}.recipients.${index}.amountStroops`));
        }
      }
      if (fixed.every((r) => inAmountRange(r.amountStroops))) {
        const total = fixed.reduce((sum, r) => sum + BigInt(r.amountStroops), 0n);
        if (total > I128_MAX) issues.push(rangeIssue(`${path}.recipients`));
      }
      // Fixed recipients take precedence over stale interval/rate fields.
      if (scheduled && fixed.length !== node.config.recipients.length) {
        const amount = node.config.amountPerIntervalStroops ?? node.config.ratePerSecondStroops;
        if (amount && !inAmountRange(amount)) {
          issues.push(
            rangeIssue(
              `${path}.${node.config.amountPerIntervalStroops ? "amountPerIntervalStroops" : "ratePerSecondStroops"}`,
            ),
          );
        }
      }
    }
  }
  return issues;
}

/** Use the compiled schedule so defaults, occurrences, and legacy rates match deployment. */
export function scheduledPaymentIssues(pipeline: PipelineNode[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const node of pipeline) {
    const p = node.params;
    if (p.kind !== "streamer") continue;
    const path = `nodes.${node.nodeId}.config`;
    if (!inAmountRange(p.amountPerIntervalStroops)) {
      issues.push(rangeIssue(path));
      continue;
    }
    const amount = BigInt(p.amountPerIntervalStroops);
    if (amount === 0n) {
      issues.push({
        path,
        message: "Scheduled payment amount must be greater than zero",
        friendlyMessage: "Set a positive amount per interval before deploying this schedule.",
      });
      continue;
    }
    const intervals = (BigInt(p.endTs) - BigInt(p.startTs)) / BigInt(p.intervalSeconds);
    if (amount * intervals > I128_MAX) {
      issues.push({
        path,
        message: "Maximum scheduled payout exceeds the supported i128 range",
        friendlyMessage:
          "Reduce the amount per interval or shorten the schedule so its total fits on chain.",
      });
    }
  }
  return issues;
}
