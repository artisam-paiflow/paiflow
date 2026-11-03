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
import { assetContractId } from "./assets";
import { decodeExecutionCapabilities, decodeExecutionState } from "./execution-v1";
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

/** No latest-registry lookup: discovery uses the exact artifacts pinned by deployment. */
export async function readExecutionState(
  deployment: ExecutionDeployment,
  /** Read-only additional getters inside the SAME instance fence (e.g. mutation
   * obligations). May run again on retry; never persist observations here. */
  inspect?: (current: SupportedExecutionState, getter: ExecutionStateGetter) => Promise<void>,
): Promise<ExecutionDiscovery> {
  if (deployment.status !== "CONFIRMED" || deployment.network !== env().STELLAR_NETWORK)
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  const graph = FlowGraphSchema.parse(deployment.graphSnapshot);
  if (!graph.fieldPolicies)
    return {
      supported: false,
      deploymentId: deployment.id,
      network: env().STELLAR_NETWORK,
      policyVersion: 0,
      reason: "Legacy deployment: execution inputs and mutable configuration are unavailable",
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
  const account = await loadPaymentAccount(server, source).catch(() => {
    throw unavailable();
  });
  // Retry the complete observation once on actual writes or inconsistent RPC evidence.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const before = await readInstances(server, snapshot);
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
      const values: Array<{
        capabilities: ReturnType<typeof decodeExecutionCapabilities>;
        state: ReturnType<typeof decodeExecutionState>;
      }> = [];
      // At most four simultaneous RPC calls, including two getters for each node.
      for (let offset = 0; offset < snapshot.length; offset += 2) {
        values.push(
          ...(await Promise.all(
            snapshot.slice(offset, offset + 2).map(async (node) => {
              const [capability, state] = await Promise.all([
                getter(node.contractAddress, "capabilities"),
                getter(node.contractAddress, "current_config"),
              ]);
              const capabilities = decodeExecutionCapabilities(capability, node.wasmHash);
              if (
                capabilities.policyVersion !== 1 ||
                !capabilities.execution ||
                !isDeepStrictEqual(capabilities, node.artifactCapabilities)
              )
                throw unavailable();
              return {
                capabilities,
                state: decodeExecutionState(state, {
                  nodeId: node.nodeId,
                  contractAddress: node.contractAddress,
                  confirmedLedger: ledger,
                  templateKind: node.templateKind,
                }),
              };
            }),
          )),
        );
      }
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
      await inspect?.(current, getter);
      const after = await readInstances(server, snapshot);
      if (
        after.ledger < before.ledger ||
        getterLedgers.some((observed) => observed > after.ledger) ||
        !isDeepStrictEqual(before.versions, after.versions)
      )
        throw unavailable();
      // Every getter's instance dependencies were unchanged throughout the bracket,
      // so their decoded values also describe the final common snapshot.
      return {
        ...current,
        confirmedLedger: after.ledger,
        configurations: current.configurations.map((configuration) => ({
          ...configuration,
          confirmedLedger: after.ledger,
        })),
      };
    } catch {
      if (attempt === 1) throw unavailable();
    }
  }
  throw unavailable();
}
