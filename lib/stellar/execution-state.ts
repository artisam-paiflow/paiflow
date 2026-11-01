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
import { executionPath, executionPolicy } from "@/lib/flows/execution-v1";
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
import { assertExecutionArtifact } from "./execution-artifacts";

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
    "Execution capabilities and current configuration could not be verified; no payment was prepared",
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

/** Only values declared mutable may differ from original evidence. This phase
 * enables no mutable fields; execution fields are tagged absent, never defaults. */
function assertOriginalConfiguration(graph: FlowGraph, current: ConfirmedNodeConfiguration) {
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
      !isDeepStrictEqual(payoutValue, current.configuration.payoutValue) ||
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
    const expected = node.config.recipients.map((row, index) => ({
      rowId: policy.rows[index]!.rowId,
      ...(policy.rows[index]!.recipient === "execution" ? {} : { recipient: row.address }),
      ...(policy.rows[index]!.allocation === "execution"
        ? {}
        : {
            allocation:
              row.mode === "fixed"
                ? { kind: "fixed", amountStroops: BigInt(row.amountStroops).toString() }
                : { kind: "percentage", bps: row.bps },
          }),
    }));
    if (
      !isDeepStrictEqual(expected, current.configuration.configuredRows) ||
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
      node.artifactCapabilities.mutation
    )
      throw unavailable();
  }
  if (
    graph.fieldPolicies.nodes.some((policy) =>
      policy.kind === "pay"
        ? policy.recipient === "mutable" || policy.payoutValue === "mutable"
        : policy.additionalRecipients === "mutable" ||
          policy.rows.some((row) => row.recipient === "mutable" || row.allocation === "mutable"),
    )
  )
    throw new AppError(
      "VALIDATION",
      "Mutable configuration is not available for this execution ABI",
    );
  const server = sorobanRpc();
  const source = stellarRelayerAddress() ?? deployment.sourceAccount;
  if (!source) throw unavailable();
  const account = await loadPaymentAccount(server, source).catch(() => {
    throw unavailable();
  });
  const keys = snapshot.map((node) => instanceKey(node.contractAddress));
  // One bounded retry can obtain a stable ledger if a close races the first read.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const before = await server.getLatestLedger();
      const ledger = z.number().int().positive().max(0xffff_ffff).parse(before.sequence);
      const entries = await server._getLedgerEntries(...keys);
      if (
        entries.latestLedger !== ledger ||
        !Array.isArray(entries.entries) ||
        entries.entries.length !== keys.length
      )
        throw unavailable();
      for (const [index, key] of keys.entries()) {
        const matches = entries.entries.filter((entry) => entry.key === key.toXDR("base64"));
        if (matches.length !== 1) throw unavailable();
        const entry = xdr.LedgerEntryData.fromXDR(matches[0]!.xdr, "base64").contractData();
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
      }
      const getter = async (contract: string, method: string): Promise<unknown> => {
        const tx = new TransactionBuilder(
          new Account(account.accountId(), account.sequenceNumber()),
          { fee: BASE_FEE, networkPassphrase: stellarPassphrase() },
        )
          .addOperation(new Contract(contract).call(method))
          .setTimeout(30)
          .build();
        const sim = await server.simulateTransaction(tx);
        if (!rpc.Api.isSimulationSuccess(sim) || sim.latestLedger !== ledger || !sim.result?.retval)
          throw unavailable();
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
                capabilities.mutation ||
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
      const after = await server.getLatestLedger();
      if (after.sequence !== ledger) throw unavailable();
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
      return ExecutionDiscoverySchema.parse({
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
    } catch {
      if (attempt === 1) throw unavailable();
    }
  }
  throw unavailable();
}
