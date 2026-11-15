import "server-only";
import type { Deployment } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { ConditionalMutationStateSchema } from "@/lib/mutations/conditional-schema";
import { recordConditionalConfigurationObservations } from "@/lib/mutations/conditional-history";
import { readConditionalExecutionState } from "./conditional-execution-state";

export async function readConditionalMutationState(
  deployment: Deployment,
  finalRead?: () => Promise<void>,
) {
  const current = await readConditionalExecutionState(deployment, { finalRead });
  if (!current.supported)
    throw new AppError(
      "VALIDATION",
      "This deployment has no guarded conditional mutation capability",
    );
  const state = ConditionalMutationStateSchema.parse({
    ...current,
    admin: current.definition.owner,
    mutationSupported: true,
  });
  await recordConditionalConfigurationObservations(
    deployment.id,
    state.statuses.map(({ state }) => state),
    state.confirmedLedger,
  );
  return state;
}
