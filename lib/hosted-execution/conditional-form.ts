import {
  ConditionalExecutionDiscoverySchema,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import {
  conditionalExecutionArgumentsSchema,
  selectConditionalBranch,
  type ConditionalPayNode,
  type ConditionalSplitNode,
} from "@/lib/flows/conditional-v2";
import type { Allocation, NodeExecutionInput } from "@/lib/flows/field-policies";
import { tokenAmountToStroops } from "@/lib/flows/schema";
import type { AdditionalDraft, HostedFieldValues } from "./form";
import { canonicalHostedValue } from "./conditional-ownership-binding";
function supported(raw: SupportedConditionalExecutionState) {
  const state = ConditionalExecutionDiscoverySchema.parse(raw);
  if (!state.supported) throw new Error("Verified conditional terms are unavailable");
  return state;
}
export function conditionalHostedRequirements(
  raw: SupportedConditionalExecutionState,
  amountStroops: string,
) {
  const state = supported(raw),
    selection = selectConditionalBranch(state.definition, amountStroops),
    terminal =
      selection.selectedBranch === "true"
        ? state.definition.trueBranch
        : state.definition.falseBranch;
  const nodes: Array<ConditionalPayNode | ConditionalSplitNode> = [
    ...state.definition.prefix,
    ...(terminal.kind === "return_to_owner" ? [] : [terminal]),
  ];
  return {
    branch: selection.selectedBranch,
    amountAtConditionStroops: selection.amountAtConditionStroops,
    nodes,
  };
}
function allocation(mode: "fixed" | "percentage", value: string): Allocation {
  if (mode === "fixed") {
    if (!/^\d+(\.\d{1,7})?$/.test(value))
      throw new Error("Enter an amount with up to seven decimal places");
    return { kind: "fixed", amountStroops: tokenAmountToStroops(value) };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a percentage with up to two decimal places");
  const [whole = "0", fraction = ""] = value.split("."),
    bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (bps < 1n || bps > 10000n)
    throw new Error("Percentage must be greater than zero and at most 100");
  return { kind: "percentage", bps: Number(bps) };
}
export function conditionalFormArguments(
  state: SupportedConditionalExecutionState,
  amountStroops: string,
  fields: HostedFieldValues,
  rosters: Record<string, AdditionalDraft[]>,
) {
  const requirements = conditionalHostedRequirements(state, amountStroops),
    inputs: NodeExecutionInput[] = [],
    allowedFields = new Set<string>(),
    allowedRosters = new Set<string>();
  const field = (node: string, row: string, key: string) => {
    const identity = `${node}:${row}:${key}`;
    allowedFields.add(identity);
    return fields[identity] ?? "";
  };
  for (const node of requirements.nodes) {
    const p = node.policy;
    if (p.kind === "pay") {
      if (p.recipient === "execution")
        inputs.push({
          kind: "pay",
          nodeId: p.nodeId,
          recipient: field(p.nodeId, "pay", "recipient"),
        });
      continue;
    }
    const rows = p.rows
      .filter((row) => row.recipient === "execution" || row.allocation === "execution")
      .map((row) => ({
        rowId: row.rowId,
        ...(row.recipient === "execution"
          ? { recipient: field(p.nodeId, row.rowId, "recipient") }
          : {}),
        ...(row.allocation === "execution"
          ? { allocation: allocation(p.allocationMode, field(p.nodeId, row.rowId, "allocation")) }
          : {}),
      }));
    if (p.additionalRecipients === "execution") allowedRosters.add(p.nodeId);
    if (rows.length || p.additionalRecipients === "execution")
      inputs.push({
        kind: "split",
        nodeId: p.nodeId,
        rows,
        ...(p.additionalRecipients === "execution"
          ? {
              additionalRecipients: (rosters[p.nodeId] ?? []).map((row) => ({
                rowId: row.rowId,
                recipient: row.recipient,
                allocation: allocation(p.allocationMode, row.allocation),
              })),
            }
          : {}),
      });
  }
  if (
    Object.keys(fields).some((key) => !allowedFields.has(key)) ||
    Object.keys(rosters).some((key) => !allowedRosters.has(key))
  )
    throw new Error("Inactive branch and constant fields cannot be supplied as payment inputs");
  return conditionalExecutionArgumentsSchema(state.definition, amountStroops).parse({
    version: 2,
    inputs,
  });
}
/** Ledger/obligation churn is not a new payment configuration. Both branches,
 * all artifacts and revisions remain part of the actual reviewed identity. */
export function conditionalHostedTermsIdentity(state: SupportedConditionalExecutionState) {
  const parsed = supported(state);
  return canonicalHostedValue({ definition: parsed.definition, nodes: parsed.nodes });
}
