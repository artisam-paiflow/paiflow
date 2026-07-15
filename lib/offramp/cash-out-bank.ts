import { TemplateKind } from "@prisma/client";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";

export type CashOutBank = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
};

/**
 * Whether a cash_out contract event should spawn an off-ramp job. Payroll
 * deployments are excluded: their jobs are created by the payroll cron (with
 * payrollRunId/employeeId) and would otherwise be duplicated by the splitter's
 * cash_out events.
 */
export function eventCreatesOffRampJob(flowTemplateKind: TemplateKind): boolean {
  return flowTemplateKind !== TemplateKind.PAYROLL;
}

/**
 * Resolve bank details for a cash_out pipeline node from the flow graph.
 * Explicit cash_out nodes carry the destination directly; generated terminals
 * (`{parentId}-cashout-{i}`, synthesized for fiat pay/split payouts) are not
 * graph nodes — their bank details live on the parent action's fiat recipient
 * config. Returns null when nothing matches (callers fall back to the Employee
 * table for payroll deployments).
 */
export function bankDetailsFromGraph(graph: FlowGraph, nodeId: string): CashOutBank | null {
  const node = graph.nodes.find(
    (n): n is Extract<FlowNode, { type: "cash_out" }> => n.type === "cash_out" && n.id === nodeId,
  );
  if (node?.config.bankCode) {
    return {
      accountName: node.config.accountName,
      accountNumber: node.config.accountNumber,
      bankCode: node.config.bankCode,
    };
  }

  const generated = /^(.+)-cashout-(\d+)$/.exec(nodeId);
  if (!generated) return null;

  const parent = graph.nodes.find((n) => n.id === generated[1]);
  if (parent?.type === "pay" && parent.config.payoutMode === "fiat" && parent.config.bankCode) {
    return {
      accountName: parent.config.accountName ?? "",
      accountNumber: parent.config.accountNumber ?? "",
      bankCode: parent.config.bankCode,
    };
  }
  if (parent?.type === "split") {
    const recipient = parent.config.recipients[Number(generated[2])];
    if (recipient?.payoutMode === "fiat" && recipient.bankCode) {
      return {
        accountName: recipient.accountName ?? "",
        accountNumber: recipient.accountNumber ?? "",
        bankCode: recipient.bankCode,
      };
    }
  }

  return null;
}
