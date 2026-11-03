import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";
import { MUTATION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
import { decodeExecutionCapabilities, decodeExecutionState } from "@/lib/stellar/execution-v1";
import { assertOriginalConfiguration } from "@/lib/stellar/execution-state";
import { MutationStateSchema } from "@/lib/mutations/schema";
import { mutationConstructors, mutationPacket, type MutationScenario } from "./mutation-acceptance";

export type GuestNodeObservation = {
  nodeId: string;
  address: string;
  configuration: xdr.ScVal;
  capabilities: xdr.ScVal;
  status: xdr.ScVal;
};
export type GuestObservation = {
  packetHash: string;
  wasmHashes: string[];
  acceptedMutationAuth: xdr.SorobanAuthorizationEntry;
  balances: string[];
  nodes: GuestNodeObservation[];
  events: { address: string; topics: xdr.ScVal[]; value: xdr.ScVal }[];
};
const vector = (value: xdr.ScVal) => {
  if (value.switch().name !== "scvVec" || value.vec() === null)
    throw new Error("Expected observation vector");
  return value.vec()!;
};
const bytes = (value: xdr.ScVal) => {
  if (value.switch().name !== "scvBytes") throw new Error("Expected observation bytes");
  return value.bytes();
};
function decode(item: MutationScenario, encoded: xdr.ScVal): GuestObservation {
  const packet = vector(xdr.ScVal.fromXDR(bytes(encoded)));
  if (packet.length !== 6 || !bytes(packet[0]!).equals(Buffer.from(mutationPacket(item), "hex")))
    throw new Error("Guest observations are not bound to the exact production packet");
  const wasmHashes = vector(packet[1]!).map((value) => bytes(value).toString("hex"));
  const constructors = mutationConstructors(item);
  if (
    JSON.stringify(wasmHashes) !==
    JSON.stringify(
      constructors.map(
        (node) =>
          MUTATION_V1_WASM_HASHES[node.templateKind as keyof typeof MUTATION_V1_WASM_HASHES],
      ),
    )
  )
    throw new Error("Guest-loaded WASMs differ from the pinned mutation generation");
  const nodes = vector(packet[2]!).map((value, index) => {
    const fields = vector(value),
      original = constructors[index];
    if (
      fields.length !== 5 ||
      !original ||
      fields[0]!.str().toString() !== original.nodeId ||
      Address.fromScVal(fields[1]!).toString() !== original.address
    )
      throw new Error("Guest node identity differs from its constructor packet");
    return {
      nodeId: original.nodeId,
      address: original.address,
      configuration: fields[2]!,
      capabilities: fields[3]!,
      status: fields[4]!,
    };
  });
  if (nodes.length !== constructors.length || vector(packet[5]!).length !== constructors.length)
    throw new Error("Guest observation omits a participating node or balance");
  // A node observation has five values; tolerate no silent field extensions.
  return {
    packetHash: createHash("sha256").update(bytes(packet[0]!)).digest("hex"),
    wasmHashes,
    nodes,
    acceptedMutationAuth: xdr.SorobanAuthorizationEntry.fromXDR(bytes(packet[4]!)),
    balances: vector(packet[5]!).map((value) => String(scValToNative(value))),
    events: vector(packet[3]!).map((value) => {
      const fields = vector(value);
      if (fields.length !== 3) throw new Error("Invalid guest configuration receipt");
      const address = Address.fromScVal(fields[0]!).toString();
      if (!constructors.some((node) => node.address === address))
        throw new Error("Unknown guest event emitter");
      return { address, topics: vector(fields[1]!), value: fields[2]! };
    }),
  };
}
export function mutationObservations(item: MutationScenario) {
  const file = path.join(
    process.cwd(),
    "tests/fixtures/mutation-acceptance",
    `${item.name}.observations.xdr-hex`,
  );
  const stages = vector(xdr.ScVal.fromXDR(readFileSync(file, "utf8").trim(), "hex"));
  if (stages.length !== (item.fixed ? 3 : 2))
    throw new Error("Expected initial/changed and fixed-obligation guest observations");
  return {
    initial: decode(item, stages[0]!),
    changed: decode(item, stages[1]!),
    blocked: item.fixed ? decode(item, stages[2]!) : undefined,
  };
}

/** Presentation fixture from real guest getters. The API acceptance test also
 * compares this result with the production reader/SDK response, not just itself. */
export function guestMutationState(
  item: MutationScenario,
  observation: GuestObservation,
  deploymentId: string,
  ledger: number,
) {
  const constructors = mutationConstructors(item);
  const states = observation.nodes.map((node, index) =>
    decodeExecutionState(scValToNative(node.configuration), {
      nodeId: node.nodeId,
      contractAddress: node.address,
      templateKind: constructors[index]!.templateKind,
      confirmedLedger: ledger,
    }),
  );
  const root = states[0]!;
  if (root.kind !== "on_receive") throw new Error("Expected root getter");
  const configurations = states.slice(1).map((state) => {
    if (state.kind === "on_receive") throw new Error("Unexpected root in child getters");
    assertOriginalConfiguration(item.graph, state.configuration);
    return state.configuration;
  });
  const statuses = observation.nodes
    .slice(1)
    .map(
      (node) =>
        scValToNative(node.status) as { admin: string; node_id: string; obligations: bigint },
    );
  return MutationStateSchema.parse({
    supported: true,
    policyVersion: 1,
    deploymentId,
    network: "testnet",
    confirmedLedger: ledger,
    rootContract: observation.nodes[0]!.address,
    assetContract: root.asset,
    minAmountStroops: root.minAmountStroops,
    policies: item.graph.fieldPolicies,
    configurations,
    nodes: observation.nodes.map((node, index) => {
      const state = states[index]!;
      return {
        nodeId: node.nodeId,
        contractAddress: node.address,
        expectedRevision:
          state.kind === "on_receive" ? state.revision : state.configuration.revision,
        capabilities: decodeExecutionCapabilities(
          scValToNative(node.capabilities),
          observation.wasmHashes[index]!,
        ),
      };
    }),
    admin: statuses[0]!.admin,
    mutationSupported: true,
    obligations: statuses.map((status) => ({
      nodeId: status.node_id,
      obligationsStroops: String(status.obligations),
    })),
  });
}
