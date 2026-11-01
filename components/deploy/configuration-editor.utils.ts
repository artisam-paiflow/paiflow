import { z } from "zod";
import {
  ConfirmedNodeConfigurationSchema,
  type ConfirmedNodeConfiguration,
  type MutationArguments,
} from "@/lib/flows/field-policies";
import {
  MutationPrepareSchema,
  MutationStateSchema,
  MutationPreparedSchema,
  MutationReconciledSchema,
  MutationPreparationRefusalSchema,
  type MutationPrepare,
} from "@/lib/mutations/schema";

export type ConfigurationState = z.infer<typeof MutationStateSchema>;
export type ConfigurationPrepared = z.infer<typeof MutationPreparedSchema>;
export const configurationRecoveryKey = (ownerId: string, network: string, deploymentId: string) =>
  `paiflow_configuration:${ownerId}:${network}:${deploymentId}`;
export const CONFIGURATION_RECOVERY_EVENT = "paiflow-configuration-recovery";
export const ConfigurationRecoverySchema = z
  .object({
    ownerId: z.uuid(),
    deploymentId: z.uuid(),
    network: z.enum(["testnet", "mainnet"]),
    key: z.string().min(8).max(128),
    request: MutationPrepareSchema,
    reviewed: MutationStateSchema,
    phase: z.enum(["preparing", "prepared", "signing", "submitted", "held", "final", "refused"]),
    prepared: MutationPreparedSchema.nullable(),
    result: MutationReconciledSchema.nullable(),
    refusal: MutationPreparationRefusalSchema.nullable(),
    attemptId: z.uuid().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.reviewed.deploymentId !== r.deploymentId ||
      r.reviewed.network !== r.network ||
      r.request.admin !== r.reviewed.admin ||
      (!["preparing", "refused"].includes(r.phase) && !r.prepared) ||
      ((r.phase === "signing" || r.phase === "submitted") && !r.attemptId) ||
      (r.phase === "final" && (!r.result || !configurationOutcomeIsTerminal(r.result))) ||
      (r.phase === "refused" &&
        (!r.refusal ||
          r.prepared ||
          r.refusal.deploymentId !== r.deploymentId ||
          r.refusal.network !== r.network ||
          r.refusal.admin !== r.request.admin))
    )
      ctx.addIssue({ code: "custom", message: "Configuration recovery identity is inconsistent" });
    if (r.prepared) {
      try {
        assertConfigurationPrepared(r.prepared, r.reviewed, r.request);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Prepared mutation does not match its reviewed identity",
        });
      }
    }
    if (
      r.result &&
      (r.result.intent !== r.prepared?.intent ||
        r.result.transaction.txHash !== r.prepared?.txHash ||
        r.result.transaction.network !== r.network)
    )
      ctx.addIssue({ code: "custom", message: "Reconciliation belongs to another mutation" });
  });
export type ConfigurationRecovery = z.infer<typeof ConfigurationRecoverySchema>;

export function readConfigurationRecovery(key: string): ConfigurationRecovery | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const parsed = ConfigurationRecoverySchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Saved configuration recovery is invalid. Resolve the original update before preparing another.",
    );
  return parsed.data;
}
export function saveConfigurationRecovery(key: string, value: ConfigurationRecovery) {
  const parsed = ConfigurationRecoverySchema.parse(value);
  localStorage.setItem(key, JSON.stringify(parsed));
  if (JSON.stringify(readConfigurationRecovery(key)) !== JSON.stringify(parsed))
    throw new Error(
      "Original update recovery could not be saved. No signing or submission will begin.",
    );
  window.dispatchEvent(new Event(CONFIGURATION_RECOVERY_EVENT));
}
export function configurationRevisionKey(state: ConfigurationState) {
  return JSON.stringify({
    deploymentId: state.deploymentId,
    network: state.network,
    admin: state.admin,
    asset: state.assetContract,
    nodes: state.nodes.map((n) => ({
      nodeId: n.nodeId,
      contractAddress: n.contractAddress,
      revision: n.expectedRevision,
      capabilities: n.capabilities,
    })),
    configurations: state.configurations.map(({ confirmedLedger: _ledger, ...c }) => c),
  });
}
export function assertConfigurationPrepared(
  prepared: ConfigurationPrepared,
  state: ConfigurationState,
  request: MutationPrepare,
) {
  const p = MutationPreparedSchema.parse(prepared),
    expected = MutationPrepareSchema.parse(request);
  if (
    p.network !== state.network ||
    p.walletAddress !== state.admin ||
    p.mutation.admin !== expected.admin ||
    p.mutation.deploymentId !== state.deploymentId ||
    p.mutation.network !== state.network ||
    p.mutation.rootContract !== state.rootContract ||
    JSON.stringify(p.mutation.arguments) !== JSON.stringify(expected.arguments) ||
    JSON.stringify(p.mutation.nodes) !==
      JSON.stringify(
        state.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
          nodeId,
          contractAddress,
          expectedRevision,
        })),
      ) ||
    JSON.stringify(p.mutation.artifacts) !==
      JSON.stringify(
        state.nodes.map(({ nodeId, contractAddress, capabilities }) => ({
          nodeId,
          contractAddress,
          wasmHash: capabilities.wasmHash,
        })),
      )
  )
    throw new Error(
      "The prepared update does not match the reviewed deployment, admin, revisions or values.",
    );
}
export function configurationOutcomeIsTerminal(outcome: z.infer<typeof MutationReconciledSchema>) {
  return (
    (outcome.state === "SUCCESS" && outcome.transaction.status === "SUCCESS") ||
    (outcome.state === "FAILED" && outcome.transaction.status === "FAILED") ||
    (outcome.state === "EXPIRED" &&
      outcome.transaction.status === "REJECTED" &&
      outcome.transaction.error?.code === "EXPIRED")
  );
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Call only with fresh authenticated response evidence. A local marker is not
 * proof that the server fenced admission. */
export async function assertConfigurationRefusal(
  raw: unknown,
  record: Pick<ConfigurationRecovery, "deploymentId" | "network" | "request" | "key">,
) {
  const proof = MutationPreparationRefusalSchema.parse(raw),
    request = MutationPrepareSchema.parse(record.request);
  const digest = await sha256(
    JSON.stringify(
      canonical({ deploymentId: record.deploymentId, network: record.network, input: request }),
    ),
  );
  if (
    proof.deploymentId !== record.deploymentId ||
    proof.network !== record.network ||
    proof.admin !== request.admin ||
    proof.idempotencyKeyHash !== (await sha256(record.key)) ||
    proof.requestDigest !== digest
  )
    throw new Error(
      "Refusal evidence does not match the original preparation identity. Recovery is retained.",
    );
  return proof;
}

export function proposedConfigurations(state: ConfigurationState, request: MutationPrepare) {
  const drafts = structuredClone(state.configurations);
  for (const change of request.arguments.changes) {
    const node = drafts.find((n) => n.nodeId === change.nodeId);
    if (!node) throw new Error("Unknown proposed node");
    if (change.kind === "pay" && node.configuration.kind === "pay") {
      if (change.recipient !== undefined) node.configuration.recipient = change.recipient;
      if (change.payoutValue !== undefined) node.configuration.payoutValue = change.payoutValue;
    } else if (change.kind === "split" && node.configuration.kind === "split") {
      for (const patch of change.rows) {
        const row = node.configuration.configuredRows.find((r) => r.rowId === patch.rowId);
        if (!row) throw new Error("Unknown proposed row");
        if (patch.recipient !== undefined) row.recipient = patch.recipient;
        if (patch.allocation !== undefined) row.allocation = patch.allocation;
      }
      if (change.additionalRecipients !== undefined)
        node.configuration.additionalRecipients = change.additionalRecipients;
    } else throw new Error("Proposed node kind differs");
  }
  if (
    JSON.stringify(configurationChanges(state, drafts)) !==
    JSON.stringify(MutationPrepareSchema.parse(request))
  )
    throw new Error("Proposed update differs from the declared mutable changes");
  return drafts;
}

/** Build only declared mutable differences; shared schemas validate the complete
 * resulting roster and monetary bounds before any preparation request. */
export function configurationChanges(
  state: ConfigurationState,
  drafts: ConfirmedNodeConfiguration[],
): MutationPrepare {
  if (drafts.length !== state.configurations.length)
    throw new Error("Configuration nodes cannot be added or removed.");
  const changes: MutationArguments["changes"] = [];
  for (const [index, original] of state.configurations.entries()) {
    const draft = drafts[index];
    if (
      !draft ||
      draft.nodeId !== original.nodeId ||
      draft.contractAddress !== original.contractAddress ||
      draft.revision !== original.revision ||
      JSON.stringify(draft.policy) !== JSON.stringify(original.policy)
    )
      throw new Error("Configuration identity and lifetime modes cannot change.");
    const validated = ConfirmedNodeConfigurationSchema.parse(draft),
      policy = original.policy;
    if (
      original.configuration.kind === "pay" &&
      validated.configuration.kind === "pay" &&
      policy.kind === "pay"
    ) {
      const before = original.configuration,
        after = validated.configuration;
      if (before.payoutValue.kind !== after.payoutValue.kind)
        throw new Error("Payout kind is immutable.");
      const recipient = before.recipient !== after.recipient ? after.recipient : undefined;
      const payoutValue =
        JSON.stringify(before.payoutValue) !== JSON.stringify(after.payoutValue)
          ? after.payoutValue
          : undefined;
      if (recipient !== undefined && policy.recipient !== "mutable")
        throw new Error("Recipient is not declared mutable.");
      if (payoutValue && (policy.payoutValue !== "mutable" || payoutValue.kind === "full"))
        throw new Error("Payout value is immutable.");
      if (recipient !== undefined || payoutValue)
        changes.push({
          kind: "pay",
          nodeId: original.nodeId,
          expectedRevision: original.revision,
          ...(recipient === undefined ? {} : { recipient }),
          ...(payoutValue ? { payoutValue } : {}),
        });
    } else if (
      original.configuration.kind === "split" &&
      validated.configuration.kind === "split" &&
      policy.kind === "split"
    ) {
      const before = original.configuration,
        after = validated.configuration;
      const rows = after.configuredRows.flatMap((row, i) => {
        const old = before.configuredRows[i]!,
          declared = policy.rows[i]!;
        const recipient = row.recipient !== old.recipient ? row.recipient : undefined;
        const allocation =
          JSON.stringify(row.allocation) !== JSON.stringify(old.allocation)
            ? row.allocation
            : undefined;
        if (recipient !== undefined && declared.recipient !== "mutable")
          throw new Error("Configured recipient is immutable.");
        if (allocation && declared.allocation !== "mutable")
          throw new Error("Configured allocation is immutable.");
        return recipient !== undefined || allocation
          ? [
              {
                rowId: row.rowId,
                ...(recipient === undefined ? {} : { recipient }),
                ...(allocation ? { allocation } : {}),
              },
            ]
          : [];
      });
      const changedAdditional =
        JSON.stringify(before.additionalRecipients) !== JSON.stringify(after.additionalRecipients);
      if (changedAdditional && policy.additionalRecipients !== "mutable")
        throw new Error("The appended roster is immutable.");
      if (rows.length || changedAdditional)
        changes.push({
          kind: "split",
          nodeId: original.nodeId,
          expectedRevision: original.revision,
          rows,
          ...(changedAdditional ? { additionalRecipients: after.additionalRecipients } : {}),
        });
    } else throw new Error("Configuration kind cannot change.");
  }
  return MutationPrepareSchema.parse({ admin: state.admin, arguments: { version: 1, changes } });
}
