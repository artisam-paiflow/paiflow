import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment } from "@prisma/client";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import {
  ConditionalExecutionDiscoverySchema,
  type ConditionalExecutionDiscovery,
  type SupportedConditionalExecutionState,
} from "@/lib/api/v1/conditional-execution-schema";
import { env, stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalDeploymentEnvelopeSchema,
  conditionalDefinitionFromStates,
  hasConditionalDeploymentDeclaration,
} from "@/lib/flows/conditional-deployment";
import {
  ConditionalNodeStateSchema,
  type ConditionalNodeState,
} from "@/lib/flows/conditional-v2-state";
import { ContractAddressSchema, PolicyIdSchema, REUSABLE_LIMITS } from "@/lib/flows/field-policies";
import { PipelineImplementationSchema } from "@/lib/flows/implementation";
import { log } from "@/lib/log";
import { sorobanRpc } from "./client";
import {
  ConditionalArtifactCapabilitiesSchema,
  conditionalArtifactMetadata,
} from "./conditional-artifacts";
import {
  conditionalContractAddress,
  decodeConditionalGuardedCapabilities,
  decodeConditionalManifest,
  decodeConditionalMutationStatus,
  decodeConditionalNodeState,
} from "./conditional-v2-codec";
import {
  interactiveRpcBudget,
  interactiveRpcBudgetExpired,
  InteractiveRpcDeadlineError,
} from "./interactive-rpc-budget";
import { loadPaymentAccount } from "./load-payment-account";
import { observeRpcPhase } from "./rpc-phase";

export type ConditionalExecutionDeployment = Pick<
  Deployment,
  | "id"
  | "network"
  | "status"
  | "graphSnapshot"
  | "paramsSnapshot"
  | "pipelineSnapshot"
  | "sourceAccount"
>;
/** New-generation salt encoding only. Legacy/v1 Buffer JSON is unchanged.
 * The #1227 writer must retain this exact salt and semantic implementation. */
export const ConditionalPipelineSnapshotSchema = z
  .array(
    z
      .object({
        nodeId: PolicyIdSchema,
        contractAddress: ContractAddressSchema,
        templateKind: z.enum(["DEPOSIT_TRIGGER", "PAYER", "SPLITTER", "ROUTER"]),
        salt: z.string().regex(/^[a-f0-9]{64}$/),
        implementation: PipelineImplementationSchema,
        wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
        artifactCapabilities: ConditionalArtifactCapabilitiesSchema,
      })
      .strict(),
  )
  .min(4)
  .max(REUSABLE_LIMITS.nodes);
type Snapshot = z.infer<typeof ConditionalPipelineSnapshotSchema>;
export type ConditionalExecutionReadOptions = {
  /** Independent payer-account read overlaps the complete closing fence. */
  finalRead?: () => Promise<void>;
};
const unavailable = () =>
  new AppError(
    "UPSTREAM_RPC",
    "Conditional execution and current configuration could not be verified",
  );
const invalidEvidence = () =>
  new AppError("VALIDATION", "Deployment has no unambiguous conditional construction evidence");
const LedgerSchema = z.number().int().positive().max(0xffff_ffff);
const methods = [
  "capabilities_v2",
  "graph_manifest_v2",
  "initial_config_v2",
  "mutation_status_v2",
] as const;
type Method = (typeof methods)[number];
type GetterRequest = { contractAddress: string; method: Method };

/** Mirror on-chain immutable-leaf comparison; a current schema alone does not
 * prove the original constants or deployment generation. */
export function assertOriginalConditionalConfiguration(
  rawOriginal: ConditionalNodeState,
  rawCurrent: ConditionalNodeState,
): void {
  const original = ConditionalNodeStateSchema.parse(rawOriginal);
  const current = ConditionalNodeStateSchema.parse(rawCurrent);
  const normalized = structuredClone(current);
  normalized.revision = "0";
  const initial = original.configuration;
  const value = normalized.configuration;
  if (initial.kind !== value.kind) throw unavailable();
  if (initial.kind === "condition" && value.kind === "condition") {
    if (initial.thresholdMode === "mutable") value.thresholdStroops = initial.thresholdStroops;
  } else if (initial.kind === "pay" && value.kind === "pay") {
    if (initial.configuration.payoutValue.kind !== value.configuration.payoutValue.kind)
      throw unavailable();
    if (initial.policy.recipient === "mutable")
      value.configuration.recipient = initial.configuration.recipient;
    if (initial.policy.payoutValue === "mutable")
      value.configuration.payoutValue = initial.configuration.payoutValue;
  } else if (initial.kind === "split" && value.kind === "split") {
    if (value.configuration.configuredRows.length !== initial.configuration.configuredRows.length)
      throw unavailable();
    initial.policy.rows.forEach((policy, index) => {
      const row = value.configuration.configuredRows[index]!;
      const before = initial.configuration.configuredRows[index]!;
      if (policy.recipient === "mutable") row.recipient = before.recipient;
      if (policy.allocation === "mutable") row.allocation = before.allocation;
    });
    if (initial.policy.additionalRecipients === "mutable")
      value.configuration.additionalRecipients = initial.configuration.additionalRecipients;
  }
  if (
    !isDeepStrictEqual(normalized, original) ||
    (current.revision === "0" && !isDeepStrictEqual(current, original))
  )
    throw unavailable();
}
function instanceKey(contract: string) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}
/** The exact approved getters depend only on instance storage. Last-modified
 * sequence detects a write followed by restoration of identical instance bytes. */
async function readInstances(server: ReturnType<typeof sorobanRpc>, snapshot: Snapshot) {
  if (interactiveRpcBudgetExpired()) throw new InteractiveRpcDeadlineError();
  const keys = snapshot.map((node) => instanceKey(node.contractAddress));
  const response = await server._getLedgerEntries(...keys);
  const ledger = LedgerSchema.parse(response.latestLedger);
  if (!Array.isArray(response.entries) || response.entries.length !== keys.length)
    throw unavailable();
  const entries = response.entries;
  const versions = keys.map((key, index) => {
    const matching = entries.filter((entry) => entry.key === key.toXDR("base64"));
    if (matching.length !== 1) throw unavailable();
    const entry = matching[0]!;
    const modified = LedgerSchema.parse(entry.lastModifiedLedgerSeq);
    const liveUntil = LedgerSchema.parse(entry.liveUntilLedgerSeq);
    if (modified > ledger || liveUntil < ledger) throw unavailable();
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64");
    if (data.switch().name !== "contractData") throw unavailable();
    const value = data.contractData();
    if (
      !value.contract().toXDR().equals(key.contractData().contract().toXDR()) ||
      !value.key().toXDR().equals(key.contractData().key().toXDR()) ||
      value.durability().name !== "persistent" ||
      value.val().switch().name !== "scvContractInstance"
    )
      throw unavailable();
    const executable = value.val().instance().executable();
    if (
      executable.switch().name !== "contractExecutableWasm" ||
      executable.wasmHash().toString("hex") !== snapshot[index]!.wasmHash
    )
      throw unavailable();
    return { xdr: data.toXDR("base64"), modified };
  });
  if (interactiveRpcBudgetExpired()) throw new InteractiveRpcDeadlineError();
  return { ledger, versions };
}
async function readGetters(
  requests: GetterRequest[],
  getter: (request: GetterRequest) => Promise<xdr.ScVal>,
) {
  const results: xdr.ScVal[] = new Array(requests.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(
    Array.from({ length: Math.min(4, requests.length) }, async () => {
      while (!failure && next < requests.length) {
        if (interactiveRpcBudgetExpired()) {
          failure = { error: new InteractiveRpcDeadlineError() };
          break;
        }
        const index = next++;
        try {
          results[index] = await getter(requests[index]!);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
  return results;
}

type Observation = {
  current: ConditionalExecutionDiscovery;
  refresh?: () => Promise<SupportedConditionalExecutionState>;
};
export async function readConditionalExecutionState(
  deployment: ConditionalExecutionDeployment,
  options: ConditionalExecutionReadOptions = {},
): Promise<ConditionalExecutionDiscovery> {
  return (await observe(deployment, options)).current;
}
export async function readConditionalExecutionStateForReview(
  deployment: ConditionalExecutionDeployment,
  options: ConditionalExecutionReadOptions = {},
): Promise<Observation> {
  return observe(deployment, options);
}
async function observe(
  deployment: ConditionalExecutionDeployment,
  options: ConditionalExecutionReadOptions,
): Promise<Observation> {
  const observationBudget = interactiveRpcBudget();
  const network = env().STELLAR_NETWORK;
  if (deployment.status !== "CONFIRMED" || deployment.network !== network)
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  if (!hasConditionalDeploymentDeclaration(deployment.paramsSnapshot))
    return {
      current: ConditionalExecutionDiscoverySchema.parse({
        version: 2,
        supported: false,
        deploymentId: deployment.id,
        network,
        policyVersion: 0,
        reason: "Deployment has no explicit conditional-v2 construction evidence",
      }),
    };
  const evidence = ConditionalDeploymentEnvelopeSchema.safeParse(deployment.paramsSnapshot);
  const parsedSnapshot = ConditionalPipelineSnapshotSchema.safeParse(deployment.pipelineSnapshot);
  if (!evidence.success || !parsedSnapshot.success) throw invalidEvidence();
  const original = evidence.data;
  const snapshot = parsedSnapshot.data;
  if (deployment.sourceAccount !== original.definition.owner) throw invalidEvidence();
  if (snapshot.length !== original.nodes.length) throw invalidEvidence();
  for (const [index, node] of snapshot.entries()) {
    const expected = original.nodes[index]!;
    const pin = original.manifest.nodes[index]!;
    try {
      if (
        node.nodeId !== expected.nodeId ||
        node.contractAddress !== expected.initialState.contractAddress ||
        node.templateKind !== expected.templateKind ||
        node.wasmHash !== pin.wasmHash ||
        !isDeepStrictEqual(node.implementation, expected.implementation) ||
        !isDeepStrictEqual(
          node.artifactCapabilities,
          conditionalArtifactMetadata(node.templateKind, node.wasmHash),
        ) ||
        conditionalContractAddress(
          original.definition.owner,
          Buffer.from(node.salt, "hex"),
          stellarPassphrase(),
        ) !== node.contractAddress
      )
        throw invalidEvidence();
    } catch {
      throw invalidEvidence();
    }
  }
  const source = stellarRelayerAddress() ?? deployment.sourceAccount;
  if (!source) throw unavailable();
  const server = sorobanRpc();
  let accountRead: ReturnType<typeof loadPaymentAccount> | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let accountFailed = false;
    let independentFailure: { error: unknown } | undefined;
    try {
      if (interactiveRpcBudgetExpired()) throw new InteractiveRpcDeadlineError();
      const [before, account] = await observeRpcPhase(
        "execution.opening",
        deployment.id,
        async () => {
          accountRead ??= loadPaymentAccount(server, source).catch(() => {
            throw unavailable();
          });
          const [instances, sourceAccount] = await Promise.allSettled([
            readInstances(server, snapshot),
            accountRead,
          ]);
          if (sourceAccount.status === "rejected") {
            accountFailed = true;
            throw sourceAccount.reason;
          }
          if (instances.status === "rejected") throw instances.reason;
          return [instances.value, sourceAccount.value] as const;
        },
        attempt,
      );
      const ledgers: number[] = [];
      const requests = snapshot.flatMap((node) =>
        methods.map((method) => ({ contractAddress: node.contractAddress, method })),
      );
      const results = await observeRpcPhase(
        "execution.getters",
        deployment.id,
        () =>
          readGetters(requests, async ({ contractAddress, method }) => {
            const tx = new TransactionBuilder(
              new Account(account.accountId(), account.sequenceNumber()),
              { fee: BASE_FEE, networkPassphrase: stellarPassphrase() },
            )
              .addOperation(new Contract(contractAddress).call(method))
              .setTimeout(30)
              .build();
            const simulation = await server.simulateTransaction(tx);
            if (
              !rpc.Api.isSimulationSuccess(simulation) ||
              ("restorePreamble" in simulation && simulation.restorePreamble) ||
              !simulation.result?.retval
            )
              throw unavailable();
            const ledger = LedgerSchema.parse(simulation.latestLedger);
            if (ledger < before.ledger) throw unavailable();
            ledgers.push(ledger);
            return simulation.result.retval;
          }),
        attempt,
      );
      const statuses = snapshot.map((_node, index) => {
        const offset = index * methods.length;
        decodeConditionalGuardedCapabilities(results[offset]);
        if (
          !isDeepStrictEqual(decodeConditionalManifest(results[offset + 1]), original.manifest) ||
          !isDeepStrictEqual(
            decodeConditionalNodeState(results[offset + 2]),
            original.manifest.nodes[index]!.state,
          )
        )
          throw unavailable();
        const status = decodeConditionalMutationStatus(results[offset + 3]);
        assertOriginalConditionalConfiguration(original.manifest.nodes[index]!.state, status.state);
        return status;
      });
      const definition = conditionalDefinitionFromStates(
        original.definition,
        statuses.map((status) => status.state),
      );
      const current = ConditionalExecutionDiscoverySchema.parse({
        version: 2,
        supported: true,
        deploymentId: deployment.id,
        network,
        policyVersion: 2,
        definition,
        confirmedLedger: before.ledger,
        nodes: snapshot.map((node, index) => ({
          nodeId: node.nodeId,
          contractAddress: node.contractAddress,
          expectedRevision: statuses[index]!.state.revision,
          wasmHash: node.wasmHash,
        })),
        statuses,
      });
      if (!current.supported) throw unavailable();
      const after = await observeRpcPhase(
        "execution.closing",
        deployment.id,
        async () => {
          const [instances, independent] = await Promise.allSettled([
            readInstances(server, snapshot),
            Promise.resolve().then(() => options.finalRead?.()),
          ]);
          if (independent.status === "rejected") {
            independentFailure = { error: independent.reason };
            throw independent.reason;
          }
          if (instances.status === "rejected") throw instances.reason;
          return instances.value;
        },
        attempt,
      );
      if (
        after.ledger < before.ledger ||
        ledgers.some((ledger) => ledger > after.ledger) ||
        !isDeepStrictEqual(before.versions, after.versions)
      )
        throw unavailable();
      // Keep the verified value private; caller edits cannot become refresh evidence.
      const verified = structuredClone(current);
      const atLedger = (ledger: number): SupportedConditionalExecutionState => ({
        ...structuredClone(verified),
        confirmedLedger: ledger,
      });
      return {
        current: atLedger(after.ledger),
        refresh: async () => {
          try {
            // This closure belongs to its original request. A caller must not
            // turn an expired request's witness into a fresh read budget.
            if (
              observationBudget &&
              (observationBudget.signal.aborted || observationBudget.deadlineAt <= Date.now())
            )
              throw new InteractiveRpcDeadlineError();
            const review = await observeRpcPhase("execution.review", deployment.id, () =>
              readInstances(server, snapshot),
            );
            if (review.ledger < after.ledger || !isDeepStrictEqual(review.versions, after.versions))
              throw new AppError(
                "CONFLICT",
                "Configuration changed; check the original payment receipt before preparing again",
              );
            return atLedger(review.ledger);
          } catch (error) {
            if (error instanceof AppError) throw error;
            throw unavailable();
          }
        },
      };
    } catch {
      const retry =
        !accountFailed && !independentFailure && attempt === 0 && !interactiveRpcBudgetExpired();
      log.warn(
        {
          deploymentId: deployment.id,
          attempt,
          retry,
          category: interactiveRpcBudgetExpired() ? "deadline" : "unverified_state",
        },
        "Conditional execution observation failed",
      );
      if (independentFailure) throw independentFailure.error;
      if (!retry) throw unavailable();
    }
  }
  throw unavailable();
}
