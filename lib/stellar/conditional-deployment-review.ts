import { Address, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { ConditionalDeploymentReviewSchema } from "@/lib/deployments/conditional-review-schema";
import { conditionalConstructorArgs, conditionalContractAddress } from "./conditional-v2-codec";
import { assertConditionalArtifact } from "./conditional-artifacts";
import { preparedWalletTransactionHash } from "./wallet-signature";

/** Client verification of one server-reviewed original. Artifact provenance still
 * comes from authoritative prepare/recovery, never this schema parser. */
export function verifyConditionalDeploymentReview(
  raw: unknown,
  input: {
    deploymentId: string;
    xdr: string;
    sourceAccount: string;
    network: "testnet" | "mainnet";
    networkPassphrase: string;
  },
) {
  const review = ConditionalDeploymentReviewSchema.parse(raw);
  const txHash = preparedWalletTransactionHash(
    input.network,
    input.xdr,
    input.sourceAccount,
    input.networkPassphrase,
  );
  if (
    review.deploymentId.toLowerCase() !== input.deploymentId.toLowerCase() ||
    review.network !== input.network ||
    review.networkPassphrase !== input.networkPassphrase ||
    review.sourceAccount !== input.sourceAccount ||
    review.txHash !== txHash
  )
    throw new Error("Conditional review differs from the original deployment transaction");
  const tx = TransactionBuilder.fromXDR(input.xdr, input.networkPassphrase);
  if (!(tx instanceof Transaction)) throw new Error("Conditional deployment must be a transaction");
  const op = tx.operations[0];
  if (
    tx.operations.length !== 1 ||
    op?.type !== "invokeHostFunction" ||
    op.source ||
    op.func.switch().name !== "hostFunctionTypeInvokeContract"
  )
    throw new Error("Conditional review requires the original factory call");
  const invoke = op.func.invokeContract();
  const args = invoke.args();
  if (
    invoke.functionName().toString() !== "deploy_pipeline" ||
    args.length !== 2 ||
    args[0]?.switch().name !== "scvAddress" ||
    Address.fromScAddress(args[0].address()).toString() !== review.sourceAccount ||
    args[1]?.switch().name !== "scvVec"
  )
    throw new Error("Conditional review factory body differs");
  const blueprints = args[1].vec() ?? [];
  if (blueprints.length !== review.envelope.nodes.length)
    throw new Error("Conditional review omits a graph node");
  blueprints.forEach((blueprint, index) => {
    if (blueprint.switch().name !== "scvMap") throw new Error("Invalid conditional blueprint");
    const fields = blueprint.map() ?? [];
    if (
      fields.length !== 3 ||
      fields
        .map((field) =>
          field.key().switch().name === "scvSymbol" ? field.key().sym().toString() : "",
        )
        .join(",") !== "constructor_args,salt,wasm_hash"
    )
      throw new Error("Invalid conditional blueprint fields");
    const [constructor, salt, hash] = fields.map((field) => field.val());
    if (
      constructor?.switch().name !== "scvVec" ||
      salt?.switch().name !== "scvBytes" ||
      hash?.switch().name !== "scvBytes"
    )
      throw new Error("Invalid conditional blueprint values");
    const node = review.envelope.nodes[index]!,
      pin = review.envelope.manifest.nodes[index]!;
    assertConditionalArtifact(node.templateKind, pin.wasmHash);
    const expected = conditionalConstructorArgs(node, review.envelope.manifest),
      actual = constructor.vec() ?? [];
    if (
      hash.bytes().toString("hex") !== pin.wasmHash ||
      conditionalContractAddress(review.sourceAccount, salt.bytes(), review.networkPassphrase) !==
        node.initialState.contractAddress ||
      actual.length !== expected.length ||
      actual.some((value, i) => !value.toXDR().equals(expected[i]!.toXDR()))
    )
      throw new Error("Conditional compiled terms differ from original constructor");
  });
  return { review, feeStroops: tx.fee };
}
