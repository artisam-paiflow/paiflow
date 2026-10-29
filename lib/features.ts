import "server-only";
import { hasRetiredPayoutInput } from "@/lib/flows/retired-inputs";
import type { TemplateKind } from "@prisma/client";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError } from "@/lib/errors";
import {
  disabledTemplateKinds,
  featureOffMessage,
  type FeatureFlags,
  type FeatureSurface,
} from "@/lib/feature-flags";
import { hiddenSurfaceIssues } from "@/lib/flows/feature-gates";
import { issuesToFields } from "@/lib/flows/issues-to-fields";
import { FlowGraphSchema, migrateFlowGraph, type FlowGraph } from "@/lib/flows/schema";
/** The surface switches for this server, from `FEATURE_*_ENABLED` (all default on). */
const warnedUnrecognised = new Set<string>();
/**
 * Only an explicit ON keeps a surface on: unset is ON (the env default), a
 * recognised off is OFF, and a value `env()` could not read is OFF too, with a
 * warning, so a typo during an event hides the surface instead of crashing
 * every route or leaving it showing.
 */
function switchOn(name: string, value: boolean | "unrecognised" | undefined): boolean {
  if (value === "unrecognised") {
    if (!warnedUnrecognised.has(name)) {
      warnedUnrecognised.add(name);
      log.warn(
        { variable: name },
        "unrecognised feature switch value; treating the surface as off",
      );
    }
    return false;
  }
  return value !== false;
}
export function serverFeatures(): FeatureFlags {
  const e = env();
  // A caller holding a partial env (a test double) reads unset, so ON.
  return {
    payroll: switchOn("FEATURE_PAYROLL_ENABLED", e.FEATURE_PAYROLL_ENABLED),
    aiAssistant: switchOn("FEATURE_AI_ASSISTANT_ENABLED", e.FEATURE_AI_ASSISTANT_ENABLED),
    oracleCondition: switchOn(
      "FEATURE_ORACLE_CONDITION_ENABLED",
      e.FEATURE_ORACLE_CONDITION_ENABLED,
    ),
  };
}
export function isFeatureEnabled(surface: FeatureSurface): boolean {
  return serverFeatures()[surface];
}
/**
 * The guard for a route that only exists for a surface. A switched-off surface
 * answers 404 NOT_FOUND, the same as its pages' `notFound()`: to a caller the
 * route is not there on this server, and 403 would suggest a permission they
 * could obtain. The message says why, so a partner script is not left guessing.
 */
export function requireFeature(surface: FeatureSurface): void {
  if (!isFeatureEnabled(surface)) {
    throw new AppError("NOT_FOUND", featureOffMessage(surface));
  }
}
/**
 * The guard for a request to a route that stays up for existing deployments
 * but asks for new use of a disabled surface. The offending field gets a 422.
 */
export function refuseIfFeatureOff(surface: FeatureSurface, field: string): void {
  if (!isFeatureEnabled(surface)) {
    const message = featureOffMessage(surface);
    throw new AppError("VALIDATION", message, { [field]: [message] });
  }
}
/**
 * Refuses a deploy that would create a switched-off surface: every node of the
 * graph, then every contract kind of the generated pipeline, the way the
 * sandbox guard in `/api/deployments/prepare` checks each pipeline node. The
 * graph check names the node; the pipeline check backs it up for any shape the
 * graph check does not model.
 */
export function assertNoHiddenSurfaces(
  graph: FlowGraph,
  pipelineKinds: readonly string[],
  features: FeatureFlags = serverFeatures(),
): void {
  if (
    hasRetiredPayoutInput(graph) ||
    pipelineKinds.some((kind) => kind === "CASH_OUT" || kind === "CASH_OUT_DEV")
  )
    throw new AppError("VALIDATION", "Fiat off-ramping has been retired.");
  const issues = hiddenSurfaceIssues(graph, features);
  if (issues.length > 0) {
    throw new AppError("VALIDATION", issues[0]!.friendlyMessage, issuesToFields(issues));
  }
  const refused = disabledTemplateKinds(features);
  const hit = [...new Set(pipelineKinds.filter((k) => (refused as readonly string[]).includes(k)))];
  if (hit.length > 0) {
    throw new AppError(
      "VALIDATION",
      `This flow builds ${hit.join(", ")} ${hit.length === 1 ? "contract" : "contracts"}, which ${hit.length === 1 ? "is" : "are"} turned off on this server.`,
    );
  }
}
/**
 * The same refusal for a deployment prepared earlier and submitted now: a
 * switch turned off between prepare and submit still stops the deploy, since
 * nothing is on chain yet. Reads the stored snapshots; a graph that no longer
 * parses is checked on its pipeline kinds alone.
 */
export function assertPreparedDeploymentAllowed(
  graphSnapshot: unknown,
  pipelineSnapshot: unknown,
  features: FeatureFlags = serverFeatures(),
): void {
  if (hasRetiredPayoutInput(graphSnapshot) || hasRetiredPayoutInput(pipelineSnapshot))
    throw new AppError("VALIDATION", "Fiat off-ramping has been retired.");
  const parsed = FlowGraphSchema.safeParse(migrateFlowGraph(graphSnapshot));
  const kinds = Array.isArray(pipelineSnapshot)
    ? (
        pipelineSnapshot as Array<{
          templateKind?: TemplateKind;
        }>
      )
        .map((n) => n?.templateKind)
        .filter((k): k is TemplateKind => typeof k === "string")
    : [];
  assertNoHiddenSurfaces(parsed.success ? parsed.data : { nodes: [], edges: [] }, kinds, features);
}
