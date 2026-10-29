import { TemplateKind } from "@prisma/client";

export const FEATURE_SURFACES = ["offramp", "payroll", "aiAssistant", "oracleCondition"] as const;
export type FeatureSurface = (typeof FEATURE_SURFACES)[number];
export type FeatureFlags = Readonly<Record<FeatureSurface, boolean>>;
export const ALL_FEATURES_ON: FeatureFlags = {
  offramp: true,
  payroll: true,
  aiAssistant: true,
  oracleCondition: true,
};
/**
 * What each surface covers in a flow graph and a pipeline. This is the single
 * source of truth for "which blocks can be hidden": the validator, the prepare
 * route and the builder all read it, and anything that describes the visible
 * blocks (the LLM guide, #716) should subtract these rather than keep its own
 * list.
 *
 * - `nodeTypes`: flow node types refused outright.
 * - `conditionKinds`: `condition` node kinds refused.
 * - `fiatPayout`: pay nodes and split recipients with `payoutMode: "fiat"`.
 * - `templateKinds`: contract kinds refused in a generated pipeline, the second
 *   line of defence at prepare/submit (the graph check comes first).
 */
export const FEATURE_GATED_BLOCKS: Readonly<
  Record<
    FeatureSurface,
    {
      envVar: string;
      label: string;
      /** What to do about a node that uses the surface, after the "turned off" sentence. */
      remedy: string;
      nodeTypes: readonly string[];
      conditionKinds: readonly string[];
      fiatPayout: boolean;
      templateKinds: readonly TemplateKind[];
    }
  >
> = {
  offramp: {
    envVar: "FEATURE_OFFRAMP_ENABLED",
    label: "Fiat off-ramp",
    remedy: "Pay out in crypto instead, or remove the step.",
    nodeTypes: ["cash_out"],
    conditionKinds: [],
    fiatPayout: true,
    templateKinds: [TemplateKind.CASH_OUT],
  },
  payroll: {
    envVar: "FEATURE_PAYROLL_ENABLED",
    label: "Payroll",
    remedy: "Use a Subscription or On Schedule trigger instead.",
    nodeTypes: ["payroll"],
    conditionKinds: [],
    fiatPayout: false,
    templateKinds: [TemplateKind.PAYROLL],
  },
  // Not a block: the assistant has no node, so every block list is empty and
  // it is gated on its routes and UI alone. A guide listing visible blocks
  // reads only the surfaces with nodeTypes, conditionKinds or fiatPayout.
  aiAssistant: {
    envVar: "FEATURE_AI_ASSISTANT_ENABLED",
    label: "The AI assistant",
    remedy: "",
    nodeTypes: [],
    conditionKinds: [],
    fiatPayout: false,
    templateKinds: [],
  },
  oracleCondition: {
    envVar: "FEATURE_ORACLE_CONDITION_ENABLED",
    label: "The oracle condition",
    remedy: "Pick another condition kind, or remove the condition.",
    nodeTypes: [],
    conditionKinds: ["oracle_gte"],
    fiatPayout: false,
    // Only an oracle_gte condition compiles to the CONDITIONAL contract.
    templateKinds: [TemplateKind.CONDITIONAL],
  },
};
/** The sentence shown when a surface is refused, on a node or from a route. */
export function featureOffMessage(surface: FeatureSurface): string {
  return `${FEATURE_GATED_BLOCKS[surface].label} is turned off on this server.`;
}
export function disabledSurfaces(features: FeatureFlags): FeatureSurface[] {
  return FEATURE_SURFACES.filter((s) => !features[s]);
}
/** Contract kinds a pipeline may not contain under these flags. */
export function disabledTemplateKinds(features: FeatureFlags): TemplateKind[] {
  return disabledSurfaces(features).flatMap((s) => FEATURE_GATED_BLOCKS[s].templateKinds);
}
