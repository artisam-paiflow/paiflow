import { z } from "zod";
import type { ConfirmedNodeConfiguration } from "@/lib/flows/field-policies";
import type { ConditionalNodeState } from "@/lib/flows/conditional-v2-state";
import {
  MutationStateSchema,
  MutationPreparedSchema,
  ConfigurationHistorySchema,
  type MutationPrepare,
} from "@/lib/mutations/schema";
import {
  ConditionalMutationStateSchema,
  ConditionalMutationPreparedSchema,
  ConditionalConfigurationHistorySchema,
  ConditionalMutationPrepareSchema,
  type ConditionalMutationState,
  type ConditionalMutationPrepared,
  type ConditionalMutationPrepare,
} from "@/lib/mutations/conditional-schema";
import {
  ConfigurationRecoverySchema,
  configurationChanges,
  configurationRevisionKey,
  assertConfigurationPrepared,
  assertConfigurationRefusal,
  proposedConfigurations,
  CONFIGURATION_RECOVERY_EVENT,
  type ConfigurationState,
  type ConfigurationPrepared,
  type ConfigurationRecovery,
} from "./configuration-editor.utils";
import {
  ConditionalConfigurationRecoverySchema,
  conditionalConfigurationChanges,
  conditionalConfigurationRevisionKey,
  assertConditionalConfigurationPrepared,
  assertConditionalConfigurationRefusal,
  proposedConditionalConfigurations,
  type ConditionalConfigurationRecovery,
} from "./conditional-configuration-editor.utils";
export type EditorState = ConfigurationState | ConditionalMutationState;
export type EditorPrepared = ConfigurationPrepared | ConditionalMutationPrepared;
export type EditorRecovery = ConfigurationRecovery | ConditionalConfigurationRecovery;
export type EditorRequest = MutationPrepare | ConditionalMutationPrepare;
export type EditorDraft = ConfirmedNodeConfiguration | ConditionalNodeState;
export type EditorHistory =
  | z.infer<typeof ConfigurationHistorySchema>
  | z.infer<typeof ConditionalConfigurationHistorySchema>;
export const conditionalState = (state: EditorState): state is ConditionalMutationState =>
  "version" in state && state.version === 2;
export const conditionalRecovery = (
  record: EditorRecovery,
): record is ConditionalConfigurationRecovery => "version" in record && record.version === 2;
export const editorValues = (state: EditorState): EditorDraft[] =>
  conditionalState(state) ? state.statuses.map(({ state }) => state) : state.configurations;
export const editorObligations = (state: EditorState) =>
  conditionalState(state)
    ? state.statuses.map(({ state, obligationsStroops }) => ({
        nodeId: state.nodeId,
        obligationsStroops,
      }))
    : state.obligations;
export const editorAsset = (state: EditorState) =>
  conditionalState(state) ? state.definition.assetContract : state.assetContract;
export const editorRevisionKey = (state: EditorState) =>
  conditionalState(state)
    ? conditionalConfigurationRevisionKey(state)
    : configurationRevisionKey(state);
export function editorChanges(state: EditorState, drafts: EditorDraft[]): EditorRequest {
  return conditionalState(state)
    ? conditionalConfigurationChanges(state, drafts as ConditionalNodeState[])
    : configurationChanges(state, drafts as ConfirmedNodeConfiguration[]);
}
export function editorProposed(record: EditorRecovery): EditorDraft[] {
  return conditionalRecovery(record)
    ? proposedConditionalConfigurations(record.reviewed, record.request)
    : proposedConfigurations(record.reviewed, record.request);
}
export function editorAssertPrepared(
  prepared: EditorPrepared,
  state: EditorState,
  request: EditorRequest,
) {
  if (conditionalState(state))
    assertConditionalConfigurationPrepared(
      ConditionalMutationPreparedSchema.parse(prepared),
      state,
      ConditionalMutationPrepareSchema.parse(request),
    );
  else
    assertConfigurationPrepared(
      MutationPreparedSchema.parse(prepared),
      state,
      request as MutationPrepare,
    );
}
export async function editorAssertRefusal(raw: unknown, record: EditorRecovery) {
  return conditionalRecovery(record)
    ? assertConditionalConfigurationRefusal(raw, record)
    : assertConfigurationRefusal(raw, record);
}
export function editorProtocol(conditional: boolean) {
  return {
    version: conditional ? (2 as const) : (1 as const),
    url: (base: string, operation = "", query = "") =>
      `${base}${operation}${conditional || query ? `?${conditional ? "version=2" : ""}${conditional && query ? "&" : ""}${query}` : ""}`,
    stateSchema: z
      .unknown()
      .transform((raw) =>
        conditional ? ConditionalMutationStateSchema.parse(raw) : MutationStateSchema.parse(raw),
      ),
    preparedSchema: z
      .unknown()
      .transform((raw) =>
        conditional
          ? ConditionalMutationPreparedSchema.parse(raw)
          : MutationPreparedSchema.parse(raw),
      ),
    historySchema: z
      .unknown()
      .transform((raw) =>
        conditional
          ? ConditionalConfigurationHistorySchema.parse(raw)
          : ConfigurationHistorySchema.parse(raw),
      ),
    parseRecovery: (raw: unknown): EditorRecovery =>
      conditional
        ? ConditionalConfigurationRecoverySchema.parse(raw)
        : ConfigurationRecoverySchema.parse(raw),
  };
}
/** Shared physical key/event/lock with v1. Unknown or mixed generations are never
 * fed to another parser, hidden behind another key or automatically erased. */
export function readEditorRecovery(key: string): EditorRecovery | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const decoded: unknown = JSON.parse(raw);
  if (decoded && typeof decoded === "object" && "version" in decoded)
    return ConditionalConfigurationRecoverySchema.parse(decoded);
  return ConfigurationRecoverySchema.parse(decoded);
}
export function saveEditorRecovery(key: string, value: EditorRecovery) {
  const parsed = conditionalRecovery(value)
    ? ConditionalConfigurationRecoverySchema.parse(value)
    : ConfigurationRecoverySchema.parse(value);
  localStorage.setItem(key, JSON.stringify(parsed));
  if (JSON.stringify(readEditorRecovery(key)) !== JSON.stringify(parsed))
    throw new Error(
      "Original update recovery could not be saved. No signing or submission will begin.",
    );
  window.dispatchEvent(new Event(CONFIGURATION_RECOVERY_EVENT));
}
