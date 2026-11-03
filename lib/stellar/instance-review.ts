import "server-only";
import {
  Address,
  hash,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { FlowGraph } from "@/lib/flows/schema";
import type { InstanceSnapshot } from "@/lib/flow-instances/schema";
import type { InstanceCompiledTerms } from "@/lib/flow-instances/compiled-review-schema";
import { InstancePreparedTermsSchema } from "@/lib/flow-instances/compiled-review-schema";
import { pipelineNodeConstructorArgs } from "./scval";
import { resolveAssetForNetwork } from "./assets";

function refuse(): never {
  throw new AppError(
    "CONFLICT",
    "Exact prepared constructor evidence is unavailable or inconsistent; retain the original instance for recovery",
  );
}
function contractAddress(source: string, salt: Buffer, passphrase: string) {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(passphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({ address: new Address(source).toScAddress(), salt }),
      ),
    }),
  );
  return Address.contract(hash(preimage.toXDR())).toString();
}
const references = z
  .array(
    z.object({
      nodeId: z.string(),
      templateKind: z.string(),
      contractAddress: z.string().refine(StrKey.isValidContract),
    }),
  )
  .min(1)
  .max(40);

/** Recover final constructor bindings from the original immutable envelope.
 * This function never reads current environment settings or reruns the flow compiler. */
export function preparedInstanceTerms(input: {
  unsignedXdr: string | null;
  preparedTxHash: string | null;
  pipelineSnapshot: unknown;
  snapshot: InstanceSnapshot;
  graph: FlowGraph;
  compiledTerms: InstanceCompiledTerms;
}): InstanceCompiledTerms {
  try {
    const { snapshot } = input;
    if (!input.unsignedXdr || !input.preparedTxHash) return refuse();
    const passphrase = snapshot.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
    const tx = TransactionBuilder.fromXDR(input.unsignedXdr, passphrase);
    if (
      !(tx instanceof Transaction) ||
      tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
      tx.signatures.length ||
      tx.source !== snapshot.sourceAccount ||
      tx.hash().toString("hex") !== input.preparedTxHash ||
      tx.operations.length !== 1 ||
      !tx.timeBounds ||
      BigInt(tx.timeBounds.maxTime) <= 0n ||
      BigInt(tx.timeBounds.maxTime) > BigInt(snapshot.maxTime)
    )
      return refuse();
    const op = tx.operations[0];
    if (
      op?.type !== "invokeHostFunction" ||
      (op.source && op.source !== snapshot.sourceAccount) ||
      op.func.switch().name !== "hostFunctionTypeInvokeContract"
    )
      return refuse();
    const call = op.func.invokeContract();
    if (
      Address.fromScAddress(call.contractAddress()).toString() !==
        snapshot.artifacts.factoryAddress ||
      call.functionName().toString() !== "deploy_pipeline"
    )
      return refuse();
    const args = call.args();
    if (
      args.length !== 2 ||
      Address.fromScVal(args[0]!).toString() !== snapshot.sourceAccount ||
      args[1]!.switch().name !== "scvVec"
    )
      return refuse();
    const blueprints = args[1]!.vec();
    const refs = references.parse(input.pipelineSnapshot);
    if (
      !blueprints ||
      blueprints.length !== input.compiledTerms.length ||
      refs.length !== blueprints.length ||
      snapshot.artifacts.nodes.length !== blueprints.length ||
      new Set(refs.map((n) => n.nodeId)).size !== refs.length
    )
      return refuse();
    const nodeAddresses: Record<string, string> = Object.fromEntries(
      refs.map((n) => [n.nodeId, n.contractAddress]),
    );
    const parents = new Map(input.graph.edges.map((e) => [e.target, e.source]));
    const result = input.compiledTerms.map((node, index) => {
      const pinned = snapshot.artifacts.nodes[index],
        ref = refs[index],
        blueprint = blueprints[index];
      if (
        !pinned ||
        !ref ||
        !blueprint ||
        node.nodeId !== pinned.nodeId ||
        node.templateKind !== pinned.templateKind ||
        ref.nodeId !== node.nodeId ||
        ref.templateKind !== node.templateKind ||
        blueprint.switch().name !== "scvMap"
      )
        return refuse();
      const entries = blueprint.map();
      if (
        !entries ||
        entries.length !== 3 ||
        entries.some((e) => e.key().switch().name !== "scvSymbol")
      )
        return refuse();
      const fields = new Map(entries.map((e) => [e.key().sym().toString(), e.val()]));
      if (
        fields.size !== 3 ||
        !["constructor_args", "salt", "wasm_hash"].every((k) => fields.has(k))
      )
        return refuse();
      const wasm = fields.get("wasm_hash")!,
        saltValue = fields.get("salt")!,
        encoded = fields.get("constructor_args")!;
      if (
        wasm.switch().name !== "scvBytes" ||
        wasm.bytes().toString("hex") !== pinned.wasmHash ||
        saltValue.switch().name !== "scvBytes" ||
        saltValue.bytes().length !== 32 ||
        encoded.switch().name !== "scvVec"
      )
        return refuse();
      if (
        contractAddress(snapshot.sourceAccount, saltValue.bytes(), passphrase) !==
        ref.contractAddress
      )
        return refuse();
      const actual = encoded.vec();
      if (!actual) return refuse();
      let params = node.params;
      const addressAt = (position: number) =>
        actual[position] ? Address.fromScVal(actual[position]!).toString() : refuse();
      // These are the only build-time additions/defaults. Treat the envelope as
      // authority for them, then verify EVERY constructor argument below.
      if (params.kind === "swapper") params = { ...params, router: addressAt(4) };
      if (params.kind === "timelock" || params.kind === "timelock_branch")
        params = { ...params, relayer: addressAt(6) };
      if (params.kind === "subscription_trigger") params = { ...params, relayer: addressAt(5) };
      const parentId = parents.get(node.nodeId);
      const parent =
        parentId && nodeAddresses[parentId]
          ? nodeAddresses[parentId]
          : params.kind === "deposit_trigger"
            ? undefined
            : snapshot.sourceAccount;
      const expected = pipelineNodeConstructorArgs(
        params,
        snapshot.sourceAccount,
        parent,
        nodeAddresses,
        (asset) => resolveAssetForNetwork(asset, snapshot.network).contractId(passphrase),
      );
      if (
        expected.length !== actual.length ||
        expected.some((value, i) => !value.toXDR().equals(actual[i]!.toXDR()))
      )
        return refuse();
      return { ...node, params };
    });
    return InstancePreparedTermsSchema.parse(result);
  } catch {
    return refuse();
  }
}
