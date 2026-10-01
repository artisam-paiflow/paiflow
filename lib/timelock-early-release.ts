import "server-only";
import { TemplateKind, type Deployment } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { ReleaseBeforeSchema, type ReleaseBefore } from "@/lib/api/v1/schema";
import { log } from "@/lib/log";
import { pipelineNodesOfKind } from "@/lib/flows/pipeline-snapshot";
import { withRelayerChannel } from "@/lib/stellar/relayer-channels";
import { sendReleaseByRelayer, simulateReleaseByRelayer } from "@/lib/stellar/relayer";
import { classifySimulationError } from "@/lib/timelock-release";

/**
 * Early release of a timelock_branch's "before" side (#751): "work delivered,
 * pay the before list now". The cron only ever asks for After; this is the one
 * authorised path that asks the relayer for Before. The caller has already
 * decided the requester may (owner session, or the deployment's own token).
 *
 * Simulated outside the relayer lock and sent inside it, like the cron. The
 * contract enforces the side against ledger time, so a release after the
 * deadline reverts with ConditionNotMet and is reported, never retried as After.
 */

export const DEADLINE_PASSED_MESSAGE =
  "The deadline has passed; this condition now releases to its after side automatically.";
export const NOTHING_TO_RELEASE_MESSAGE =
  "There is nothing to release: this condition holds no funds right now.";

/** An empty body is `{}`: the node id is only needed when there are several. */
export async function parseReleaseBody(req: Request): Promise<ReleaseBefore> {
  const text = await req.text();
  if (text.trim() === "") return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  }
  return ReleaseBeforeSchema.parse(raw);
}

export type EarlyReleaseResult = {
  nodeId: string;
  contractAddress: string;
  txHash: string;
  ledger?: number;
};

/** The timelock_branch node to release, from `pipelineSnapshot` and never the graph. */
export function resolveTimelockBranchNode(
  deployment: Pick<Deployment, "status" | "pipelineSnapshot">,
  nodeId?: string,
): { nodeId: string; contractAddress: string } {
  if (deployment.status !== "CONFIRMED") {
    throw new AppError("VALIDATION", "The deployment is not confirmed yet");
  }
  const nodes = pipelineNodesOfKind(deployment.pipelineSnapshot, TemplateKind.TIMELOCK_BRANCH);
  if (nodes.length === 0) {
    throw new AppError("VALIDATION", "This deployment has no timelock branch to release");
  }
  const ids = nodes.map((n) => n.nodeId);
  if (nodeId !== undefined) {
    const match = nodes.find((n) => n.nodeId === nodeId);
    if (!match) {
      throw new AppError(
        "VALIDATION",
        `No timelock branch "${nodeId}" in this deployment; choose one of: ${ids.join(", ")}`,
        { nodeId: ["Unknown timelock branch node"] },
      );
    }
    return match;
  }
  if (nodes.length > 1) {
    throw new AppError(
      "VALIDATION",
      `This deployment has several timelock branches; pass "nodeId" to choose one of: ${ids.join(", ")}`,
      { nodeId: ["Required: the deployment has several timelock branches"] },
    );
  }
  return nodes[0]!;
}

/** A contract revert on the release, as the caller should hear it. */
function refusal(contractAddress: string, error: string): AppError {
  const verdict = classifySimulationError(contractAddress, error);
  switch (verdict.kind) {
    case "not_yet":
      return new AppError("VALIDATION", DEADLINE_PASSED_MESSAGE);
    case "empty":
      return new AppError("VALIDATION", NOTHING_TO_RELEASE_MESSAGE);
    case "unsupported":
      // Server-side (older WASM, no dedicated relayer), not the caller's mistake.
      return new AppError(
        "UPSTREAM_RPC",
        `The relayer cannot release this condition: ${verdict.reason}`,
      );
    case "error":
      log.warn({ contractAddress, error }, "early-release: simulation failed");
      return new AppError(
        "UPSTREAM_RPC",
        "The release could not be simulated; try again",
        undefined,
        error,
      );
    default: {
      const unreachable: never = verdict;
      throw new Error(`unhandled verdict ${JSON.stringify(unreachable)}`);
    }
  }
}

export async function releaseTimelockBranchBefore(
  deployment: Pick<Deployment, "id" | "status" | "pipelineSnapshot">,
  nodeId?: string,
): Promise<EarlyReleaseResult> {
  const node = resolveTimelockBranchNode(deployment, nodeId);

  const sim = await simulateReleaseByRelayer(node.contractAddress, "before");
  if (!sim.ok) throw refusal(node.contractAddress, sim.error);

  let send;
  try {
    send = await withRelayerChannel((channel) =>
      sendReleaseByRelayer(node.contractAddress, sim.sim, "before", channel),
    );
  } catch (err) {
    // A channel re-simulates under the lock; a deadline that slipped by in the
    // meantime surfaces as a simulation failure, not a transport one.
    if (err instanceof AppError && err.code === "UPSTREAM_RPC") {
      const reason = /simulation failed: ([\s\S]*)$/.exec(err.message)?.[1];
      if (reason) throw refusal(node.contractAddress, reason);
    }
    throw err;
  }

  if (send.status !== "SUCCESS") {
    log.warn(
      { deploymentId: deployment.id, nodeId: node.nodeId, txHash: send.txHash },
      "early-release: transaction failed",
    );
    // On the relayer-source lane the send reuses the probe's simulation, so a
    // deadline or a balance that moved in between only shows up on chain. Ask
    // again to tell the caller why, rather than a bare failure.
    const again = await simulateReleaseByRelayer(node.contractAddress, "before").catch(() => null);
    if (again && !again.ok) {
      const kind = classifySimulationError(node.contractAddress, again.error).kind;
      if (kind === "not_yet" || kind === "empty") throw refusal(node.contractAddress, again.error);
    }
    throw new AppError(
      "UPSTREAM_RPC",
      send.errorMessage ?? "The release transaction failed",
      undefined,
      send.txHash,
    );
  }

  log.info(
    { deploymentId: deployment.id, nodeId: node.nodeId, txHash: send.txHash },
    "early-release: released before side",
  );
  return {
    nodeId: node.nodeId,
    contractAddress: node.contractAddress,
    txHash: send.txHash,
    ledger: send.ledger,
  };
}
