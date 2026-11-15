"use client";
import type { FlowNode } from "@/lib/flows/schema";
import { AmountInput } from "./inputs/amount-input";
import { Field } from "./inputs/field";
import { inputClass } from "./inputs/styles";

export function ConditionalNotice({ available }: { available: boolean }) {
  return (
    <div className="border-secondary/30 bg-secondary/5 text-on-surface-variant space-y-2 rounded border p-3 text-xs">
      <p>
        Each payment compares the amount remaining after upstream Pay deductions. Equality follows
        False. Review both branches before signing.
      </p>
      <p>
        Only declared prefix and selected-branch inputs are required. Constants and stored values
        cannot be overridden. Stored updates require the immutable owner's signature and no
        accounted obligations anywhere, including the inactive branch.
      </p>
      {!available && (
        <p role="status">
          Draft editing is available. Deployment requires this environment's exact compatible
          conditional artifacts.
        </p>
      )}
    </div>
  );
}
export function ConditionalGenerationControl({
  active,
  busy,
  onEnable,
}: {
  active: boolean;
  busy: boolean;
  onEnable: () => void;
}) {
  return active ? (
    <p className="text-on-surface-variant text-xs">
      Conditional reusable flow v2. Edit manually; AI editing and template creation are unavailable
      for this generation.
    </p>
  ) : (
    <button
      type="button"
      disabled={busy}
      onClick={onEnable}
      className="text-primary min-h-11 text-xs underline"
      title={
        busy ? "Wait for the original AI edit to finish before changing generation" : undefined
      }
    >
      Use conditional reusable payments (v2)
    </button>
  );
}
export function ConditionalConditionSettings({
  node,
  thresholdMode,
  onChange,
  onModeChange,
  available,
}: {
  node: Extract<FlowNode, { type: "condition" }>;
  thresholdMode: "constant" | "mutable";
  onChange: (node: FlowNode) => void;
  onModeChange: (mode: "constant" | "mutable") => void;
  available: boolean;
}) {
  if (node.config.kind !== "amount_gt" && node.config.kind !== "amount_lt")
    return (
      <p role="alert">Only amount comparisons are supported in a conditional reusable flow.</p>
    );
  return (
    <div className="space-y-4 p-4">
      <ConditionalNotice available={available} />
      <Field label="Amount comparison">
        {(control) => (
          <select
            {...control}
            className={inputClass}
            value={node.config.kind}
            onChange={(e) =>
              onChange({
                ...node,
                config: {
                  kind: e.target.value === "amount_lt" ? "amount_lt" : "amount_gt",
                  amountStroops:
                    node.config.kind === "amount_gt" || node.config.kind === "amount_lt"
                      ? node.config.amountStroops
                      : "0",
                },
              })
            }
          >
            <option value="amount_gt">Amount is greater than</option>
            <option value="amount_lt">Amount is less than</option>
          </select>
        )}
      </Field>
      <AmountInput
        label="Threshold"
        hint="Compared with the current payment amount after upstream Pay deductions. Equality always takes False."
        value={
          node.config.kind === "amount_gt" || node.config.kind === "amount_lt"
            ? node.config.amountStroops
            : "0"
        }
        commit="draft"
        onChange={(amountStroops) => {
          if (node.config.kind === "amount_gt" || node.config.kind === "amount_lt")
            onChange({ ...node, config: { ...node.config, amountStroops } });
        }}
      />
      <Field
        label="Threshold mode"
        hint="Constant is the default. A stored mutable threshold requires an explicit owner/admin update and a new revision; it is never supplied per payment."
      >
        {(control) => (
          <select
            {...control}
            className={inputClass}
            value={thresholdMode}
            onChange={(e) => onModeChange(e.target.value === "mutable" ? "mutable" : "constant")}
          >
            <option value="constant">Constant</option>
            <option value="mutable">Admin mutable</option>
          </select>
        )}
      </Field>
      <p className="text-on-surface-variant text-xs">
        Connect one explicit True output and one explicit False output, each directly to a terminal
        Pay, Split or Return to owner. Comparison, branch links and owner destination stay fixed
        after deployment.
      </p>
    </div>
  );
}
