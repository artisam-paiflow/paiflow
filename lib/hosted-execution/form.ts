import { z } from "zod";
import { ExecutePrepareSchema } from "@/lib/api/v1/schema";
import type { ExecutionDiscovery } from "@/lib/api/v1/execution-schema";
import {
  executionArgumentsSchema,
  type Allocation,
  type NodeExecutionInput,
} from "@/lib/flows/field-policies";
import { tokenAmountToStroops } from "@/lib/flows/schema";
import { HostedRecoveryKeySchema } from "./schema";
import { formatStroops } from "@/lib/utils";

export type HostedState = Extract<ExecutionDiscovery, { supported: true }>;
export type AdditionalDraft = { rowId: string; recipient: string; allocation: string };
export type HostedFieldValues = Record<string, string>;
export const fieldKey = (nodeId: string, rowId: string, field: string) =>
  `${nodeId}:${rowId}:${field}`;
export function tokenInput(value: string) {
  if (!/^\d+(\.\d{1,7})?$/.test(value))
    throw new Error("Enter an amount with up to seven decimal places");
  return tokenAmountToStroops(value);
}
function allocation(mode: "fixed" | "percentage", value: string): Allocation {
  if (mode === "fixed") return { kind: "fixed", amountStroops: tokenInput(value) };
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a percentage with up to two decimal places");
  const [whole = "0", fraction = ""] = value.split(".");
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (bps < 1n || bps > 10_000n)
    throw new Error("Percentage must be greater than zero and at most 100");
  return { kind: "percentage", bps: Number(bps) };
}
export function formArguments(
  state: HostedState,
  fields: HostedFieldValues,
  rosters: Record<string, AdditionalDraft[]>,
) {
  const inputs: NodeExecutionInput[] = [];
  for (const policy of state.policies.nodes) {
    if (policy.kind === "pay") {
      if (policy.recipient === "execution")
        inputs.push({
          kind: "pay",
          nodeId: policy.nodeId,
          recipient: fields[fieldKey(policy.nodeId, "pay", "recipient")] ?? "",
        });
      continue;
    }
    const rows = policy.rows
      .filter((row) => row.recipient === "execution" || row.allocation === "execution")
      .map((row) => ({
        rowId: row.rowId,
        ...(row.recipient === "execution"
          ? { recipient: fields[fieldKey(policy.nodeId, row.rowId, "recipient")] ?? "" }
          : {}),
        ...(row.allocation === "execution"
          ? {
              allocation: allocation(
                policy.allocationMode,
                fields[fieldKey(policy.nodeId, row.rowId, "allocation")] ?? "",
              ),
            }
          : {}),
      }));
    if (rows.length || policy.additionalRecipients === "execution")
      inputs.push({
        kind: "split",
        nodeId: policy.nodeId,
        rows,
        ...(policy.additionalRecipients === "execution"
          ? {
              additionalRecipients: (rosters[policy.nodeId] ?? []).map((row) => ({
                rowId: row.rowId,
                recipient: row.recipient,
                allocation: allocation(policy.allocationMode, row.allocation),
              })),
            }
          : {}),
      });
  }
  return executionArgumentsSchema(state.policies).parse({ version: 1, inputs });
}
/** Contains no signed/unsigned envelope, API credential or wallet private key. */
export const HostedBrowserRecoverySchema = z
  .object({
    recoveryKey: HostedRecoveryKeySchema,
    request: ExecutePrepareSchema,
    phase: z.enum(["ownership", "preparing", "prepared", "signing", "submitted"]),
    intent: z.uuid().optional(),
    txHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    attemptId: z.uuid().optional(),
  })
  .strict();
export type HostedBrowserRecovery = z.infer<typeof HostedBrowserRecoverySchema>;
export function restoredHostedInputs(record: HostedBrowserRecovery) {
  const fields: HostedFieldValues = {};
  const rosters: Record<string, AdditionalDraft[]> = {};
  const value = (allocation: Allocation) =>
    allocation.kind === "fixed"
      ? formatStroops(allocation.amountStroops)
      : formatStroops(BigInt(allocation.bps), 2);
  for (const input of record.request.arguments?.inputs ?? []) {
    if (input.kind === "pay") {
      fields[fieldKey(input.nodeId, "pay", "recipient")] = input.recipient;
      continue;
    }
    for (const row of input.rows) {
      if (row.recipient) fields[fieldKey(input.nodeId, row.rowId, "recipient")] = row.recipient;
      if (row.allocation)
        fields[fieldKey(input.nodeId, row.rowId, "allocation")] = value(row.allocation);
    }
    if (input.additionalRecipients)
      rosters[input.nodeId] = input.additionalRecipients.map((row) => ({
        rowId: row.rowId,
        recipient: row.recipient,
        allocation: value(row.allocation),
      }));
  }
  return { amount: formatStroops(record.request.amount), fields, rosters };
}
export const hostedRecoveryStorageKey = (id: string, network: string) =>
  `paiflow_hosted_payment:${network}:${id}`;
export function readHostedRecovery(key: string) {
  const raw = localStorage.getItem(key);
  return raw === null ? null : HostedBrowserRecoverySchema.parse(JSON.parse(raw));
}
export function saveHostedRecovery(key: string, record: HostedBrowserRecovery) {
  const checked = HostedBrowserRecoverySchema.parse(record);
  localStorage.setItem(key, JSON.stringify(checked));
  if (JSON.stringify(readHostedRecovery(key)) !== JSON.stringify(checked))
    throw new Error("Payment recovery could not be saved; no signature was requested");
}
