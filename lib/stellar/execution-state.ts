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
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { stellarPassphrase, stellarRelayerAddress, env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { executionPath, executionPolicy, hasMutablePolicies } from "@/lib/flows/execution-v1";
import {
  ArtifactCapabilitiesSchema,
  ContractAddressSchema,
  type ConfirmedNodeConfiguration,
} from "@/lib/flows/field-policies";
import { ExecutionDiscoverySchema, type ExecutionDiscovery } from "@/lib/api/v1/execution-schema";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { interactiveRpcBudgetExpired, InteractiveRpcDeadlineError } from "./interactive-rpc-budget";
import { observeRpcPhase } from "./rpc-phase";
import { assetContractId } from "./assets";
import { decodeExecutionState } from "./execution-v1";
import { assertExecutionArtifact, executionArtifactMetadata } from "./execution-artifacts";

type ExecutionDeployment = Pick<
  Deployment,
  | "id"
  | "network"
  | "status"
  | "graphSnapshot"
  | "pipelineSnapshot"
  | "paramsSnapshot"
  | "sourceAccount"
>;
const SnapshotSchema = z
  .array(
    z.object({
      nodeId: z.string().min(1),
      contractAddress: ContractAddressSchema,
      templateKind: z.string(),
      wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
      artifactCapabilities: ArtifactCapabilitiesSchema,
    }),
  )
  .min(2)
  .max(40);
const unavailable = () =>
  new AppError(
    "UPSTREAM_RPC",
    "Execution capabilities and current configuration could not be verified",
  );

function instanceKey(contract: string) {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contract).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

type SupportedExecutionState = Extract<ExecutionDiscovery, { supported: true }>;
export type ExecutionStateGetter = (
  contract: string,
  method: "capabilities" | "current_config" | "mutation_status",
) => Promise<unknown>;

const LedgerSchema = z.number().int().positive().max(0xffff_ffff);

/** The reviewed getters read only instance storage. Fence the whole read with
 * instance versions, not wall-clock ledger equality. lastModified catches writes
 * followed by a return to the same value; TTL is checked but is not configuration.
 * RPC must serve each batch from its reported ledger's consistent snapshot.
 * https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries
 */
async function readInstances(
  server: ReturnType<typeof sorobanRpc>,
  snapshot: z.infer<typeof SnapshotSchema>,
) {
  const keys = snapshot.map((node) => instanceKey(node.contractAddress));
  const response = await server._getLedgerEntries(...keys);
  const ledger = LedgerSchema.parse(response.latestLedger);
  if (!Array.isArray(response.entries) || response.entries.length !== keys.length)
    throw unavailable();
  const entries = response.entries;
  const versions = keys.map((key, index) => {
    const matches = entries.filter((entry) => entry.key === key.toXDR("base64"));
    if (matches.length !== 1) throw unavailable();
    const value = matches[0]!;
    const modified = LedgerSchema.parse(value.lastModifiedLedgerSeq);
    const liveUntil = LedgerSchema.parse(value.liveUntilLedgerSeq);
    if (modified > ledger || liveUntil < ledger) throw unavailable();
    const data = xdr.LedgerEntryData.fromXDR(value.xdr, "base64");
    if (data.switch().name !== "contractData") throw unavailable();
    const entry = data.contractData();
    if (
      !entry.contract().toXDR().equals(key.contractData().contract().toXDR()) ||
      !entry.key().toXDR().equals(key.contractData().key().toXDR()) ||
      entry.durability().name !== "persistent" ||
      entry.val().switch().name !== "scvContractInstance"
    )
      throw unavailable();
    const executable = entry.val().instance().executable();
    if (
      executable.switch().name !== "contractExecutableWasm" ||
      executable.wasmHash().toString("hex") !== snapshot[index]!.wasmHash
    )
      throw unavailable();
    return { xdr: data.toXDR("base64"), modified };
  });
  return { ledger, versions };
}

/** Only declared mutable values may differ from original evidence. Execution
 * fields are tagged absent, never configured fallback defaults. */
export function assertOriginalConfiguration(graph: FlowGraph, current: ConfirmedNodeConfiguration) {
  const node = graph.nodes.find((node) => node.id === current.nodeId);
  if (node?.type === "pay" && current.configuration.kind === "pay") {
    const policy = executionPolicy(graph, node);
    if (!policy) throw unavailable();
    const payoutValue = node.config.fullAmount
      ? { kind: "full" }
      : node.config.mode === "percentage"
        ? { kind: "percentage", bps: Math.round((node.config.percentage ?? 0) * 100) }
        : { kind: "fixed", amountStroops: BigInt(node.config.amountStroops ?? "0").toString() };
    if (
      !isDeepStrictEqual(policy, current.policy) ||
      (policy.kind === "pay" &&
        policy.payoutValue === "constant" &&
        !isDeepStrictEqual(payoutValue, current.configuration.payoutValue)) ||
      (policy.kind === "pay" && payoutValue.kind !== current.configuration.payoutValue.kind) ||
      (policy.kind === "pay" &&
        policy.recipient === "constant" &&
        node.config.recipient !== current.configuration.recipient)
    )
      throw unavailable();
    return;
  }
  if (node?.type === "split" && current.configuration.kind === "split") {
    const policy = executionPolicy(graph, node);
    if (!policy || policy.kind !== "split" || !isDeepStrictEqual(policy, current.policy))
      throw unavailable();
    if (node.config.recipients.length !== current.configuration.configuredRows.length)
      throw unavailable();
    node.config.recipients.forEach((row, index) => {
      const declared = policy.rows[index]!;
      const actual =
        current.configuration.kind === "split"
          ? current.configuration.configuredRows[index]
          : undefined;
      const allocation =
        row.mode === "fixed"
          ? { kind: "fixed", amountStroops: BigInt(row.amountStroops).toString() }
          : { kind: "percentage", bps: row.bps };
      if (
        actual?.rowId !== declared.rowId ||
        (declared.recipient === "constant" && row.address !== actual.recipient) ||
        (declared.allocation === "constant" && !isDeepStrictEqual(allocation, actual.allocation))
      )
        throw unavailable();
    });
    if (
      policy.additionalRecipients !== "mutable" &&
      current.configuration.additionalRecipients.length !== 0
    )
      throw unavailable();
    return;
  }
  throw unavailable();
}

type GetterRequest = { contractAddress: string; method: Parameters<ExecutionStateGetter>[1] };
type ReadOptions = {
  /** Additional instance-only getters, dispatched in the same bounded queue. */
  additionalReads?: (nodes: z.infer<typeof SnapshotSchema>) => GetterRequest[];
  /** Validate additional results against decoded configuration, before the final fence. */
  inspect?: (current: SupportedExecutionState, results: unknown[]) => void;
  /** Preparation-only independent read, overlapped with the closing instance fence. */
  finalRead?: () => Promise<void>;
};

/** A failure stops queued dispatch. Started calls settle before another attempt can run. */
async function readGetters(requests: GetterRequest[], getter: ExecutionStateGetter) {
  const results: unknown[] = new Array(requests.length);
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(
    Array.from({ length: Math.min(4, requests.length) }, async () => {
      while (!failure && next < requests.length) {
        if (interactiveRpcBudgetExpired()) {
          failure = { error: new InteractiveRpcDeadlineError() };
          break;
        }
        const index = next++,
          request = requests[index]!;
        try {
          results[index] = await getter(request.contractAddress, request.method);
        } catch (error) {
          failure ??= { error };
        }
      }
    }),
  );
  if (failure) throw failure.error;
  return results;
}

/** No latest-registry lookup: discovery uses the exact artifacts pinned by deployment. */
export async function readExecutionState(
  deployment: ExecutionDeployment,
  options: ReadOptions = {},
): Promise<ExecutionDiscovery> {
  return (await observeExecutionState(deployment, options)).current;
}

/** Request-local verified observation. The refresh closure retains the complete live
 * instance witness privately; callers cannot supply a graph or revision as evidence.
 * Hosted preparation uses it after admission to verify review freshness without
 * repeating getters whose complete instance dependencies have not changed.
 */
export async function readExecutionStateForReview(
  deployment: ExecutionDeployment,
  options: ReadOptions = {},
) {
  return observeExecutionState(deployment, options);
}

type ExecutionObservation = {
  current: ExecutionDiscovery;
  refresh?: () => Promise<SupportedExecutionState>;
};
async function observeExecutionState(
  deployment: ExecutionDeployment,
  options: ReadOptions = {},
): Promise<ExecutionObservation> {
  if (deployment.status !== "CONFIRMED" || deployment.network !== env().STELLAR_NETWORK)
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  const graph = FlowGraphSchema.parse(deployment.graphSnapshot);
  if (!graph.fieldPolicies)
    return {
      current: {
        supported: false,
        deploymentId: deployment.id,
        network: env().STELLAR_NETWORK,
        policyVersion: 0,
        reason: "Legacy deployment: execution inputs and mutable configuration are unavailable",
      },
    };
  const path = executionPath(graph);
  const parsed = SnapshotSchema.safeParse(deployment.pipelineSnapshot);
  if (!parsed.success)
    throw new AppError("VALIDATION", "Deployment has no unambiguous pinned execution artifacts");
  const snapshot = path.map((node) => {
    const matches = parsed.data.filter((entry) => entry.nodeId === node.id);
    if (matches.length !== 1) throw unavailable();
    return matches[0]!;
  });
  if (
    snapshot.length !== parsed.data.length ||
    new Set(snapshot.map((node) => node.contractAddress)).size !== snapshot.length
  )
    throw unavailable();
  for (const node of snapshot) {
    try {
      assertExecutionArtifact(node.templateKind, node.wasmHash);
    } catch {
      throw new AppError(
        "VALIDATION",
        "The pinned deployment artifact does not support policy-v1 execution",
      );
    }
    if (
      node.artifactCapabilities.policyVersion !== 1 ||
      !node.artifactCapabilities.execution ||
      node.artifactCapabilities.wasmHash !== node.wasmHash ||
      !isDeepStrictEqual(
        node.artifactCapabilities,
        executionArtifactMetadata(node.templateKind, node.wasmHash),
      ) ||
      (hasMutablePolicies(graph) && !node.artifactCapabilities.mutation)
    )
      throw unavailable();
  }
  const server = sorobanRpc();
  const source = stellarRelayerAddress() ?? deployment.sourceAccount;
  if (!source) throw unavailable();
  let accountRead: ReturnType<typeof loadPaymentAccount> | undefined;
  // Retry the complete observation once on actual writes or inconsistent RPC evidence.
  for (let attempt = 0; attempt < 2; attempt++) {
    let sourceAccountFailed = false;
    let independentReadFailure: { error: unknown } | undefined;
    try {
      if (interactiveRpcBudgetExpired()) throw new InteractiveRpcDeadlineError();
      const [before, account] = await observeRpcPhase(
        "execution.opening",
        deployment.id,
        async () => {
          accountRead ??= loadPaymentAccount(server, source).catch(() => {
            throw unavailable();
          });
          const results = await Promise.allSettled([readInstances(server, snapshot), accountRead]);
          const [instances, account] = results;
          if (account.status === "rejected") {
            sourceAccountFailed = true;
            throw account.reason;
          }
          if (instances.status === "rejected") throw instances.reason;
          return [instances.value, account.value] as const;
        },
        attempt,
      );
      const ledger = before.ledger;
      const getterLedgers: number[] = [];
      const getter: ExecutionStateGetter = async (contract, method) => {
        if (!snapshot.some((node) => node.contractAddress === contract)) throw unavailable();
        const tx = new TransactionBuilder(
          new Account(account.accountId(), account.sequenceNumber()),
          { fee: BASE_FEE, networkPassphrase: stellarPassphrase() },
        )
          .addOperation(new Contract(contract).call(method))
          .setTimeout(30)
          .build();
        const sim = await server.simulateTransaction(tx);
        if (
          !rpc.Api.isSimulationSuccess(sim) ||
          ("restorePreamble" in sim && sim.restorePreamble) ||
          !sim.result?.retval
        )
          throw unavailable();
        const observed = LedgerSchema.parse(sim.latestLedger);
        if (observed < ledger) throw unavailable();
        getterLedgers.push(observed);
        return scValToNative(sim.result.retval);
      };
      // For these exact reviewed executables capabilities are fixed once policy
      // initialization succeeds. current_config requires that policy to exist.
      // Both live instance fences verify the executable, so another simulation of
      // capabilities grants no additional authority and costs a queue slot/RPC.
      const requests: GetterRequest[] = snapshot.map((node) => ({
        contractAddress: node.contractAddress,
        method: "current_config",
      }));
      const extraRequests = options.additionalReads?.(snapshot) ?? [];
      const results = await observeRpcPhase(
        "execution.getters",
        deployment.id,
        () => readGetters([...requests, ...extraRequests], getter),
        attempt,
      );
      const values = snapshot.map((node, index) => {
        const capabilities = executionArtifactMetadata(node.templateKind, node.wasmHash);
        if (
          capabilities.policyVersion !== 1 ||
          !capabilities.execution ||
          !isDeepStrictEqual(capabilities, node.artifactCapabilities)
        )
          throw unavailable();
        return {
          capabilities,
          state: decodeExecutionState(results[index], {
            nodeId: node.nodeId,
            contractAddress: node.contractAddress,
            confirmedLedger: ledger,
            templateKind: node.templateKind,
          }),
        };
      });
      const root = values[0]!.state;
      if (
        root.kind !== "on_receive" ||
        path[0]!.type !== "on_receive" ||
        root.nodeId !== path[0]!.id ||
        root.nextSteps.length !== 1 ||
        root.nextSteps[0] !== snapshot[1]!.contractAddress ||
        root.asset !== assetContractId(path[0]!.config.asset) ||
        root.minAmountStroops !== BigInt(path[0]!.config.minAmountStroops ?? "0").toString()
      )
        throw unavailable();
      const configurations: ConfirmedNodeConfiguration[] = [];
      for (const [index, value] of values.slice(1).entries()) {
        const state = value.state;
        const position = index + 1;
        if (
          state.kind === "on_receive" ||
          state.asset !== root.asset ||
          state.parent !== snapshot[position - 1]!.contractAddress ||
          !isDeepStrictEqual(
            state.nextSteps,
            position + 1 < snapshot.length ? [snapshot[position + 1]!.contractAddress] : [],
          )
        )
          throw unavailable();
        assertOriginalConfiguration(graph, state.configuration);
        configurations.push(state.configuration);
      }
      const current = ExecutionDiscoverySchema.parse({
        supported: true,
        policyVersion: 1,
        deploymentId: deployment.id,
        network: deployment.network,
        rootContract: snapshot[0]!.contractAddress,
        assetContract: root.asset,
        minAmountStroops: root.minAmountStroops,
        confirmedLedger: ledger,
        policies: graph.fieldPolicies,
        configurations,
        nodes: snapshot.map((node, index) => ({
          nodeId: node.nodeId,
          contractAddress: node.contractAddress,
          expectedRevision: index === 0 ? root.revision : configurations[index - 1]!.revision,
          capabilities: values[index]!.capabilities,
        })),
      });
      if (!current.supported) throw unavailable();
      options.inspect?.(current, results.slice(requests.length));
      const after = await observeRpcPhase(
        "execution.closing",
        deployment.id,
        async () => {
          // Both reads must settle before a retry or a verified result is returned.
          const [instances, independent] = await Promise.allSettled([
            readInstances(server, snapshot),
            Promise.resolve().then(() => options.finalRead?.()),
          ]);
          if (independent.status === "rejected") {
            independentReadFailure = { error: independent.reason };
            throw independent.reason;
          }
          if (instances.status === "rejected") throw instances.reason;
          return instances.value;
        },
        attempt,
      );
      if (
        after.ledger < before.ledger ||
        getterLedgers.some((observed) => observed > after.ledger) ||
        !isDeepStrictEqual(before.versions, after.versions)
      )
        throw unavailable();
      // Every getter's instance dependencies were unchanged throughout the bracket,
      // so their decoded values also describe the final common snapshot.
      const atLedger = (confirmedLedger: number): SupportedExecutionState => ({
        ...current,
        confirmedLedger,
        configurations: current.configurations.map((configuration) => ({
          ...configuration,
          confirmedLedger,
        })),
      });
      return {
        current: atLedger(after.ledger),
        refresh: async () => {
          try {
            const review = await observeRpcPhase("execution.review", deployment.id, () =>
              readInstances(server, snapshot),
            );
            // Compare complete XDR and lastModified, not just revisions: this also
            // detects changes followed by a return to the original storage value.
            if (review.ledger < after.ledger || !isDeepStrictEqual(review.versions, after.versions))
              throw new AppError(
                "CONFLICT",
                "Configuration changed; check this payment receipt before preparing again",
              );
            return atLedger(review.ledger);
          } catch (error) {
            if (error instanceof AppError) throw error;
            throw unavailable();
          }
        },
      };
    } catch {
      log.warn(
        {
          deploymentId: deployment.id,
          attempt,
          category: interactiveRpcBudgetExpired() ? "deadline" : "unverified_state",
          retry:
            !independentReadFailure &&
            !sourceAccountFailed &&
            attempt === 0 &&
            !interactiveRpcBudgetExpired(),
        },
        "Execution observation failed",
      );
      // A preparation-only account failure keeps its original safe error semantics.
      if (independentReadFailure) throw independentReadFailure.error;
      if (attempt === 1 || sourceAccountFailed || interactiveRpcBudgetExpired())
        throw unavailable();
    }
  }
  throw unavailable();
}
