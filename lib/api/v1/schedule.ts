import "server-only";
import type { ApiTokenType } from "@/lib/api/v1/auth";
import type { Deployment } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
import { readScheduleState } from "@/lib/stellar/schedule-state";
import { sorobanRpc } from "@/lib/stellar/client";
import {
  prepareStreamerPauseInvocation,
  prepareStreamerUnpauseInvocation,
  prepareStreamerRetrieveUnvestedInvocation,
} from "@/lib/stellar/invoke";
import {
  createControlIntent,
  readControlIntent,
  reconcileControlIntent,
  WalletControlSubmitSchema,
  type WalletControlAction,
} from "./control-intent";
import { submitControlIntent } from "./control-submission";
import { linkApiTransaction } from "@/lib/api/request-history/context";

import { ScheduleStateQuerySchema, SchedulePrepareSchema, ScheduleReconcileSchema } from "./schema";

export const ScheduleActionSchema = z.enum(["pause", "resume", "retrieve"]);
export type ScheduleAction = z.infer<typeof ScheduleActionSchema>;
export { ScheduleStateQuerySchema, SchedulePrepareSchema, ScheduleReconcileSchema };
export { WalletControlSubmitSchema };
const controlAction = (action: ScheduleAction): WalletControlAction => `schedule.${action}`;

export function scheduleNode(
  deployment: Pick<Deployment, "network" | "status" | "pipelineSnapshot">,
  nodeId?: string,
) {
  if (deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment not confirmed");
  if (deployment.network !== env().STELLAR_NETWORK)
    throw new AppError("VALIDATION", "Deployment network does not match this environment");
  const snapshot = BalancePipelineSnapshotSchema.safeParse(deployment.pipelineSnapshot);
  if (!snapshot.success) throw new AppError("VALIDATION", "Deployment snapshot is invalid");
  const candidates = snapshot.data.filter(
    (node) => node.templateKind === "STREAMER" && (nodeId === undefined || node.nodeId === nodeId),
  );
  if (candidates.length !== 1)
    throw new AppError("VALIDATION", "Select an unambiguous deployed Schedule node");
  return candidates[0]!;
}

export async function scheduleState(deployment: Deployment, nodeId?: string) {
  const node = scheduleNode(deployment, nodeId);
  return {
    deploymentId: deployment.id,
    network: deployment.network,
    nodeId: node.nodeId,
    contractAddress: node.contractAddress,
    ...(await readScheduleState(node.contractAddress, deployment.sourceAccount)),
  };
}

export async function assertScheduleEligible(
  deployment: Deployment,
  nodeId: string,
  walletAddress: string,
  action: ScheduleAction,
) {
  const state = await scheduleState(deployment, nodeId);
  if (!StrKey.isValidEd25519PublicKey(state.controller) || state.controller !== walletAddress)
    throw new AppError(
      "FORBIDDEN",
      "Only the current Schedule controller wallet can sign this control",
    );
  if (action === "pause" && (!state.pauseAllowed || state.paused))
    throw new AppError("CONFLICT", "Schedule pause is not currently permitted");
  if (action === "resume" && (!state.pauseAllowed || !state.paused))
    throw new AppError("CONFLICT", "Schedule resume is not currently permitted");
  if (
    action === "retrieve" &&
    (!state.paused || !state.retrieveAllowed || BigInt(state.retrievableStroops) <= 0n)
  )
    throw new AppError(
      "CONFLICT",
      "Schedule retrieval requires a paused, permitted Schedule with unvested funds",
    );
  return state;
}

export async function prepareScheduleControl(
  deployment: Deployment,
  action: ScheduleAction,
  body: z.infer<typeof SchedulePrepareSchema>,
) {
  const node = scheduleNode(deployment, body.nodeId);
  const state = await assertScheduleEligible(deployment, node.nodeId, body.walletAddress, action);
  const preparationLedger = (
    await sorobanRpc()
      .getLatestLedger()
      .catch(() => {
        throw new AppError("UPSTREAM_RPC", "Schedule preparation ledger could not be read");
      })
  ).sequence;
  const builders = {
    pause: prepareStreamerPauseInvocation,
    resume: prepareStreamerUnpauseInvocation,
    retrieve: prepareStreamerRetrieveUnvestedInvocation,
  };
  const prepared = await builders[action]({
    contractAddress: node.contractAddress,
    invokerAddress: body.walletAddress,
  }).catch((error: unknown) => {
    if (error instanceof AppError) throw error;
    throw new AppError("UPSTREAM_RPC", "Schedule control preparation could not be simulated");
  });
  const current = await assertScheduleEligible(deployment, node.nodeId, body.walletAddress, action);
  if (
    current.controller !== state.controller ||
    current.tokenContractAddress !== state.tokenContractAddress
  )
    throw new AppError(
      "CONFLICT",
      "Schedule configuration changed during simulation; prepare again",
    );
  const intent = await createControlIntent({
    deployment,
    nodeId: node.nodeId,
    action: controlAction(action),
    walletAddress: body.walletAddress,
    unsignedXdr: prepared.xdr,
    preparationLedger,
  });
  linkApiTransaction(intent.txHash);
  return {
    ...intent,
    unsignedXdr: prepared.xdr,
    network: deployment.network,
    action,
    nodeId: node.nodeId,
    contractAddress: node.contractAddress,
    walletAddress: body.walletAddress,
    ...(action === "retrieve"
      ? {
          recipient: current.controller,
          estimatedAmountStroops: current.retrievableStroops,
          tokenContractAddress: current.tokenContractAddress,
        }
      : {}),
  };
}

export async function submitScheduleControl(input: {
  deployment: Deployment;
  tokenId: string;
  tokenType?: ApiTokenType;
  action: ScheduleAction;
  intent: string;
  signedXdr: string;
  ip: string;
}) {
  const intent = await readControlIntent(
    input.intent,
    input.deployment.id,
    controlAction(input.action),
  );
  return submitControlIntent({
    ...input,
    action: controlAction(input.action),
    assertEligible: async () => {
      const node = scheduleNode(input.deployment, intent.nodeId);
      if (node.contractAddress !== intent.contractAddress)
        throw new AppError(
          "CONFLICT",
          "Prepared Schedule no longer matches the deployment snapshot",
        );
      await assertScheduleEligible(
        input.deployment,
        intent.nodeId,
        intent.walletAddress,
        input.action,
      );
    },
  });
}

export async function reconcileScheduleControl(
  deployment: Deployment,
  action: ScheduleAction,
  intentId: string,
) {
  const intent = await reconcileControlIntent(intentId, deployment.id, controlAction(action));
  linkApiTransaction(intent.txHash);
  return {
    intent: intent.id,
    txHash: intent.txHash,
    network: intent.network,
    action,
    state: intent.state,
    replacementAllowed: ["SUCCESS", "FAILED", "EXPIRED"].includes(intent.state),
  };
}

/** Malformed JSON is a client validation error, never an internal error. */
export async function readScheduleJson(req: Pick<Request, "json">): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  }
}
