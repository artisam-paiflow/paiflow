"use client";
import type { Asset } from "@/lib/flows/schema";
import type { ConditionalNodeState } from "@/lib/flows/conditional-v2-state";
import { AmountInput } from "@/components/builder/inputs/amount-input";
import { ConfigurationValues } from "./configuration-values";
import type { EditorDraft } from "./configuration-protocol";
export function EditorConfigurationValues({
  values,
  asset,
  onChange,
  disabled,
  revisionLabel,
}: {
  values: EditorDraft[];
  asset?: Asset;
  onChange?: (values: EditorDraft[]) => void;
  disabled?: boolean;
  revisionLabel?: string;
}) {
  const conditionIndex = values.findIndex(
    (value) => value.version === 2 && value.configuration.kind === "condition",
  );
  return (
    <div className="space-y-4">
      {values.map((node, index) => {
        if (node.version !== 2)
          return (
            <ConfigurationValues
              key={node.nodeId}
              values={[node]}
              asset={asset}
              disabled={disabled}
              revisionLabel={revisionLabel}
              onChange={
                onChange
                  ? ([value]) => {
                      const next = structuredClone(values);
                      next[index] = value!;
                      onChange(next);
                    }
                  : undefined
              }
            />
          );
        const config = node.configuration;
        const branch =
          conditionIndex >= 0 && index > conditionIndex
            ? index === conditionIndex + 1
              ? "True branch"
              : "False branch"
            : index > 0 && conditionIndex > index
              ? "Upstream prefix"
              : null;
        function edit(change: (state: ConditionalNodeState) => void) {
          const next = structuredClone(values);
          change(next[index] as ConditionalNodeState);
          onChange?.(next);
        }
        if (config.kind === "pay" || config.kind === "split")
          return (
            <div key={node.nodeId}>
              {branch && <p className="mb-1 text-sm font-medium">{branch}</p>}
              <ConfigurationValues
                values={[
                  {
                    nodeId: node.nodeId,
                    contractAddress: node.contractAddress,
                    revision: node.revision,
                    policy: config.policy,
                    configuration: config.configuration,
                  },
                ]}
                asset={asset}
                disabled={disabled}
                revisionLabel={revisionLabel}
                onChange={
                  onChange
                    ? ([value]) =>
                        edit((state) => {
                          if (
                            state.configuration.kind === "pay" &&
                            value?.configuration.kind === "pay"
                          )
                            state.configuration.configuration = value.configuration;
                          if (
                            state.configuration.kind === "split" &&
                            value?.configuration.kind === "split"
                          )
                            state.configuration.configuration = value.configuration;
                        })
                    : undefined
                }
              />
            </div>
          );
        return (
          <fieldset
            key={node.nodeId}
            disabled={disabled}
            className="border-outline-variant/50 space-y-2 rounded border p-3"
          >
            <legend className="px-1 font-medium">
              {branch ? `${branch} · ` : ""}
              {config.kind === "condition"
                ? "Condition"
                : config.kind === "receive"
                  ? "Receive"
                  : "Return to owner"}{" "}
              {node.nodeId} · {revisionLabel ?? "revision"} {node.revision}
            </legend>
            <p className="font-mono text-xs break-all">{node.contractAddress}</p>
            {config.kind === "condition" ? (
              <>
                <p className="text-sm">
                  Strict {config.comparison === "amount_gt" ? "greater than" : "less than"}{" "}
                  comparison after upstream Pay deductions. Equality takes False. Threshold mode:{" "}
                  {config.thresholdMode}.
                </p>
                {onChange && config.thresholdMode === "mutable" ? (
                  <AmountInput
                    label={`Threshold for ${node.nodeId}`}
                    asset={asset}
                    commit="draft"
                    value={config.thresholdStroops}
                    onChange={(thresholdStroops) =>
                      edit((state) => {
                        if (state.configuration.kind === "condition")
                          state.configuration.thresholdStroops = thresholdStroops;
                      })
                    }
                  />
                ) : (
                  <p>
                    Threshold: {config.thresholdStroops} stroops ({config.thresholdMode})
                  </p>
                )}
                <p className="text-xs break-all">
                  True terminal: {node.nextContracts[0]} · False terminal: {node.nextContracts[1]}
                </p>
              </>
            ) : config.kind === "receive" ? (
              <p>Minimum receive amount: {config.minAmountStroops} stroops (immutable)</p>
            ) : (
              <p className="break-all">
                Immutable owner recipient: {config.recipient}. Return pays this deployment owner,
                never the payer.
              </p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
