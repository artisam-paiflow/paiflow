import { signPrepared, parseConditionalPreparationRefusal } from "@paiflow/sdk";
import type { ConditionalMutationArguments, PaiflowDeployment, PreparedSigner } from "@paiflow/sdk";

/** Caller persists request/key and original receipt before requesting a signature.
 * A fresh current read is never a replacement for recovering an unknown original.
 */
export async function prepareConditionalConfiguration(input: {
  deployment: PaiflowDeployment;
  changes: ConditionalMutationArguments["changes"];
  savedKey: string;
}) {
  const current = await input.deployment.configuration.conditional.get();
  // Review prefix AND both branches; every accounted obligation blocks mutation.
  if (current.data.statuses.some((s) => s.obligationsStroops !== "0"))
    throw new Error("Settle every accounted obligation before changing configuration");
  return input.deployment.configuration.conditional.prepare(
    { admin: current.data.admin, arguments: { version: 2, changes: input.changes } },
    { idempotencyKey: input.savedKey },
  );
}
export async function signConditionalConfiguration(
  original: Awaited<ReturnType<typeof prepareConditionalConfiguration>>,
  wallet: PreparedSigner,
) {
  return signPrepared(original, wallet, {
    walletAddress: original.data.walletAddress,
    expectedNetwork: original.data.network,
  });
}
export async function recoverConditionalConfiguration(
  deployment: PaiflowDeployment,
  original: Awaited<ReturnType<typeof prepareConditionalConfiguration>>,
) {
  return deployment.configuration.conditional.reconcile({ intent: original.data.intent });
}
/** Parse error.fields.preparationRefusal[0] only after handling a PaiflowApiError.
 * The caller must compare deployment/admin/network and hashes with its saved
 * original key/request. A timeout, generic error or expiry is never this proof.
 */
export function reviewConditionalRefusal(serializedProof: string) {
  return parseConditionalPreparationRefusal(JSON.parse(serializedProof));
}
