import type {
  ConditionalExecutionArguments,
  ConditionalDefinition,
  PaiflowDeployment,
  PreparedSigner,
} from "@paiflow/sdk";
import { signPrepared, selectConditionalExecutionBranch } from "@paiflow/sdk";

/** Trusted application boundary. Choose only declared prefix/selected-branch
 * inputs from verified discovery and the payment amount. The API independently
 * computes the branch; callers never send an authoritative branch selector.
 * Persist this original request/key/receipt before invoking the wallet callback.
 */
export async function prepareConditionalPayment(input: {
  deployment: PaiflowDeployment;
  payer: string;
  amountStroops: string;
  selectedInputs: (
    route: ReturnType<typeof selectConditionalExecutionBranch>,
    definition: ConditionalDefinition,
  ) => ConditionalExecutionArguments["inputs"];
  savedPaymentKey: string;
}) {
  const state = await input.deployment.execute.conditional.state();
  if (!state.data.supported) throw new Error(state.data.reason);
  const preview = selectConditionalExecutionBranch(state.data.definition, input.amountStroops);
  return input.deployment.execute.conditional.prepare(
    {
      from: input.payer,
      amount: input.amountStroops,
      arguments: { version: 2, inputs: input.selectedInputs(preview, state.data.definition) },
    },
    { idempotencyKey: input.savedPaymentKey },
  );
}

/** Explicit sign-only and submit stages; caller persists the signed result
 * through its secure application recovery boundary before the one explicit send.
 * Uncertainty retains the same original; this example never prepares a replacement.
 */
export async function signConditionalPayment(
  original: Awaited<ReturnType<typeof prepareConditionalPayment>>,
  wallet: PreparedSigner,
) {
  return signPrepared(original, wallet, {
    walletAddress: original.data.walletAddress,
    expectedNetwork: original.data.network,
  });
}

export async function recoverConditionalPayment(
  deployment: PaiflowDeployment,
  original: Awaited<ReturnType<typeof prepareConditionalPayment>>,
) {
  return deployment.execute.conditional.reconcile({ intent: original.data.intent });
}
