import { z } from "zod";
import {
  ConditionalNodeStateSchema,
  type ConditionalNodeState,
} from "@/lib/flows/conditional-v2-state";
import {
  conditionalMutationArgumentsSchema,
  type ConditionalMutationArguments,
} from "@/lib/flows/conditional-v2";
import {
  ConditionalMutationPrepareSchema,
  ConditionalMutationStateSchema,
  ConditionalMutationPreparedSchema,
  ConditionalPreparationRefusalSchema,
  type ConditionalMutationState,
  type ConditionalMutationPrepare,
  type ConditionalMutationPrepared,
} from "@/lib/mutations/conditional-schema";
import { MutationReconciledSchema } from "@/lib/mutations/schema";
import { assertConditionalConfigurationEnvelope } from "@/lib/stellar/conditional-configuration-review";
import { configurationOutcomeIsTerminal } from "./configuration-editor.utils";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sameConfigurationUuid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function conditionalConfigurationRevisionKey(state: ConditionalMutationState) {
  return JSON.stringify({
    deploymentId: state.deploymentId.toLowerCase(),
    network: state.network,
    admin: state.admin,
    definition: state.definition,
    nodes: state.nodes,
    states: state.statuses.map(({ state }) => state),
  });
}
export function conditionalConfigurationChanges(
  state: ConditionalMutationState,
  rawDrafts: ConditionalNodeState[],
): ConditionalMutationPrepare {
  const drafts = z.array(ConditionalNodeStateSchema).parse(rawDrafts);
  if (drafts.length !== state.statuses.length)
    throw new Error("Configuration nodes cannot be added or removed.");
  const changes: ConditionalMutationArguments["changes"] = [];
  state.statuses.forEach(({ state: original }, index) => {
    const draft = drafts[index]!;
    const normalized = structuredClone(draft);
    const before = original.configuration,
      after = draft.configuration,
      copy = normalized.configuration;
    if (before.kind !== after.kind || before.kind !== copy.kind)
      throw new Error("Configuration kind is immutable.");
    if (before.kind === "condition" && after.kind === "condition" && copy.kind === "condition") {
      if (before.thresholdMode === "mutable") copy.thresholdStroops = before.thresholdStroops;
      if (after.thresholdStroops !== before.thresholdStroops)
        changes.push({
          kind: "condition",
          nodeId: original.nodeId,
          expectedRevision: original.revision,
          thresholdStroops: after.thresholdStroops,
        });
    } else if (before.kind === "pay" && after.kind === "pay" && copy.kind === "pay") {
      const recipient =
        before.configuration.recipient !== after.configuration.recipient
          ? after.configuration.recipient
          : undefined;
      const payoutValue = equal(before.configuration.payoutValue, after.configuration.payoutValue)
        ? undefined
        : after.configuration.payoutValue;
      if (before.policy.recipient === "mutable")
        copy.configuration.recipient = before.configuration.recipient;
      if (before.policy.payoutValue === "mutable")
        copy.configuration.payoutValue = before.configuration.payoutValue;
      if (recipient !== undefined || payoutValue !== undefined)
        changes.push({
          kind: "pay",
          nodeId: original.nodeId,
          expectedRevision: original.revision,
          ...(recipient === undefined ? {} : { recipient }),
          ...(payoutValue && payoutValue.kind !== "full" ? { payoutValue } : {}),
        });
    } else if (before.kind === "split" && after.kind === "split" && copy.kind === "split") {
      const rows = after.configuration.configuredRows.flatMap((row, i) => {
        const old = before.configuration.configuredRows[i],
          policy = before.policy.rows[i],
          restored = copy.configuration.configuredRows[i];
        if (!old || !policy || !restored)
          throw new Error("Configured rows cannot change identity or order.");
        const recipient = old.recipient !== row.recipient ? row.recipient : undefined;
        const allocation = equal(old.allocation, row.allocation) ? undefined : row.allocation;
        if (policy.recipient === "mutable") restored.recipient = old.recipient;
        if (policy.allocation === "mutable") restored.allocation = old.allocation;
        return recipient !== undefined || allocation !== undefined
          ? [
              {
                rowId: row.rowId,
                ...(recipient === undefined ? {} : { recipient }),
                ...(allocation ? { allocation } : {}),
              },
            ]
          : [];
      });
      const appended = !equal(
        before.configuration.additionalRecipients,
        after.configuration.additionalRecipients,
      );
      if (before.policy.additionalRecipients === "mutable")
        copy.configuration.additionalRecipients = before.configuration.additionalRecipients;
      if (rows.length || appended)
        changes.push({
          kind: "split",
          nodeId: original.nodeId,
          expectedRevision: original.revision,
          rows,
          ...(appended ? { additionalRecipients: after.configuration.additionalRecipients } : {}),
        });
    }
    if (!equal(normalized, original))
      throw new Error(
        "Constants, modes, routing, asset, owner, revisions and configured row identities are immutable.",
      );
  });
  const arguments_ = conditionalMutationArgumentsSchema(state.definition, state.nodes).parse({
    version: 2,
    changes,
  });
  return ConditionalMutationPrepareSchema.parse({ admin: state.admin, arguments: arguments_ });
}
export function proposedConditionalConfigurations(
  state: ConditionalMutationState,
  request: ConditionalMutationPrepare,
) {
  const parsed = ConditionalMutationPrepareSchema.parse(request);
  conditionalMutationArgumentsSchema(state.definition, state.nodes).parse(parsed.arguments);
  const drafts = structuredClone(state.statuses.map(({ state }) => state));
  for (const change of parsed.arguments.changes) {
    const node = drafts.find((node) => node.nodeId === change.nodeId)!;
    const config = node.configuration;
    if (change.kind === "condition" && config.kind === "condition")
      config.thresholdStroops = change.thresholdStroops;
    else if (change.kind === "pay" && config.kind === "pay") {
      if (change.recipient !== undefined) config.configuration.recipient = change.recipient;
      if (change.payoutValue !== undefined) config.configuration.payoutValue = change.payoutValue;
    } else if (change.kind === "split" && config.kind === "split") {
      for (const patch of change.rows) {
        const row = config.configuration.configuredRows.find((row) => row.rowId === patch.rowId)!;
        if (patch.recipient !== undefined) row.recipient = patch.recipient;
        if (patch.allocation !== undefined) row.allocation = patch.allocation;
      }
      if (change.additionalRecipients !== undefined)
        config.configuration.additionalRecipients = change.additionalRecipients;
    } else throw new Error("Proposed configuration kind differs.");
  }
  conditionalConfigurationChanges(state, drafts);
  return drafts;
}
export function assertConditionalConfigurationPrepared(
  prepared: ConditionalMutationPrepared,
  state: ConditionalMutationState,
  request: ConditionalMutationPrepare,
) {
  const p = ConditionalMutationPreparedSchema.parse(prepared),
    input = ConditionalMutationPrepareSchema.parse(request);
  assertConditionalConfigurationEnvelope(p);
  if (
    p.network !== state.network ||
    p.walletAddress !== state.admin ||
    p.mutation.admin !== input.admin ||
    !sameConfigurationUuid(p.mutation.deploymentId, state.deploymentId) ||
    p.mutation.rootContract !== state.nodes[0]!.contractAddress ||
    !equal(p.mutation.definition, state.definition) ||
    !equal(p.mutation.nodes, state.nodes) ||
    !equal(p.mutation.arguments, input.arguments)
  )
    throw new Error(
      "Prepared update differs from the reviewed complete graph, admin, revisions or changes.",
    );
}
export const ConditionalConfigurationRecoverySchema = z
  .object({
    version: z.literal(2),
    ownerId: z.uuid(),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    key: z.string().min(8).max(128),
    request: ConditionalMutationPrepareSchema,
    reviewed: ConditionalMutationStateSchema,
    phase: z.enum(["preparing", "prepared", "signing", "submitted", "held", "final", "refused"]),
    prepared: ConditionalMutationPreparedSchema.nullable(),
    result: MutationReconciledSchema.nullable(),
    refusal: ConditionalPreparationRefusalSchema.nullable(),
    attemptId: z.uuid().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      !sameConfigurationUuid(r.reviewed.deploymentId, r.deploymentId) ||
      r.network !== r.reviewed.network ||
      r.request.admin !== r.reviewed.admin ||
      (!["preparing", "refused"].includes(r.phase) && !r.prepared) ||
      ((r.phase === "signing" || r.phase === "submitted") && !r.attemptId) ||
      (r.phase === "final" && (!r.result || !configurationOutcomeIsTerminal(r.result))) ||
      (r.phase === "refused" &&
        (!r.refusal ||
          r.prepared ||
          !sameConfigurationUuid(r.refusal.deploymentId, r.deploymentId) ||
          r.refusal.network !== r.network ||
          r.refusal.admin !== r.request.admin))
    )
      ctx.addIssue({ code: "custom", message: "Conditional recovery identity is inconsistent" });
    try {
      proposedConditionalConfigurations(r.reviewed, r.request);
      if (r.prepared) assertConditionalConfigurationPrepared(r.prepared, r.reviewed, r.request);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Conditional recovery differs from its original reviewed request",
      });
    }
    if (
      r.result &&
      (!r.prepared ||
        !sameConfigurationUuid(r.result.intent, r.prepared.intent) ||
        r.result.transaction.txHash !== r.prepared.txHash ||
        r.result.transaction.network !== r.network)
    )
      ctx.addIssue({
        code: "custom",
        message: "Reconciliation belongs to another original update",
      });
  });
export type ConditionalConfigurationRecovery = z.infer<
  typeof ConditionalConfigurationRecoverySchema
>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return value;
}
const sha256 = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
export async function assertConditionalConfigurationRefusal(
  raw: unknown,
  record: Pick<
    ConditionalConfigurationRecovery,
    "deploymentId" | "network" | "request" | "key" | "reviewed"
  >,
) {
  const proof = ConditionalPreparationRefusalSchema.parse(raw),
    request = ConditionalMutationPrepareSchema.parse(record.request);
  const deploymentId = record.reviewed.deploymentId;
  const digest = await sha256(
    JSON.stringify(
      canonical({ version: 2, deploymentId, network: record.network, input: request }),
    ),
  );
  if (
    !sameConfigurationUuid(proof.deploymentId, deploymentId) ||
    !sameConfigurationUuid(record.deploymentId, deploymentId) ||
    proof.network !== record.network ||
    proof.admin !== request.admin ||
    proof.idempotencyKeyHash !== (await sha256(record.key)) ||
    proof.requestDigest !== digest
  )
    throw new Error(
      "Refusal evidence differs from the original conditional request. Recovery retained.",
    );
  return proof;
}
