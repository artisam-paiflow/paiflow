"use client";
import { useState } from "react";
import type { FlowGraph } from "@/lib/flows/schema";
import { CreationDeclarationSchema, type CreationDeclaration } from "@/lib/flow-templates/schema";
import { inputClass } from "@/components/builder/inputs/styles";
import { buttonClass } from "@/components/developer/api";
import { creationLeaves, leafLabel, parseCreationValue } from "./creation-input.utils";
import ValueInput from "./value-input";

export default function DeclarationEditor({
  graph,
  inputs,
  onChange,
  disabled,
}: {
  graph: FlowGraph;
  inputs: CreationDeclaration[];
  onChange: (inputs: CreationDeclaration[]) => void;
  disabled: boolean;
}) {
  const leaves = creationLeaves(graph);
  const [choice, setChoice] = useState("");
  const [inputId, setInputId] = useState("");
  const [label, setLabel] = useState("");
  const [useDefault, setUseDefault] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [error, setError] = useState<string | null>(null);
  const leaf = leaves[Number(choice)];
  const ordered = leaf && ["stroops", "bps", "integer", "timestamp"].includes(leaf.type);
  function add() {
    try {
      if (!choice || !leaf) throw new Error("Choose a configured field");
      const input = CreationDeclarationSchema.parse({
        ...leaf,
        inputId,
        label,
        ...(useDefault ? { defaultValue: parseCreationValue(leaf.type, defaultValue) } : {}),
        ...(ordered && (minimum || maximum)
          ? {
              constraints: {
                ...(minimum ? { min: parseCreationValue(leaf.type, minimum) } : {}),
                ...(maximum ? { max: parseCreationValue(leaf.type, maximum) } : {}),
              },
            }
          : {}),
      });
      if (
        inputs.some(
          (i) =>
            i.inputId === input.inputId ||
            JSON.stringify(i.target) === JSON.stringify(input.target),
        )
      )
        throw new Error("This input ID or field is already declared");
      onChange([...inputs, input]);
      setError(null);
      setInputId("");
      setLabel("");
    } catch {
      setError(
        "Check the unique input ID, label and typed default/bounds. Stroops must be integer strings; dates must be UTC ISO timestamps.",
      );
    }
  }
  return (
    <fieldset
      disabled={disabled}
      className="border-outline-variant/40 space-y-3 rounded border p-4"
    >
      <legend>Creation inputs — supplied once for each new instance</legend>
      <p className="text-on-surface-variant text-sm">
        Declare only fields that may differ. Published topology, field modes and undeclared values
        stay pinned. Required values never fall back to the exemplar. Targets are checked against
        the actual compiled contracts when saved and published.
      </p>
      <ul className="space-y-2">
        {inputs.map((input, i) => (
          <li
            key={input.inputId}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span>
              {input.label} ({input.inputId}) · {leafLabel(input)} ·{" "}
              {input.defaultValue
                ? `Explicit default: ${String(input.defaultValue.value)}`
                : "Required, no default"}
            </span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => onChange(inputs.filter((_, index) => index !== i))}
            >
              Remove input {input.inputId}
            </button>
          </li>
        ))}
      </ul>
      <label className="grid gap-1 text-sm">
        Configured field
        <select
          className={inputClass}
          value={choice}
          onChange={(e) => {
            setChoice(e.target.value);
            setDefaultValue("");
            setMinimum("");
            setMaximum("");
          }}
        >
          <option value="">Choose a field</option>
          {leaves.map((l, i) => (
            <option key={i} value={String(i)}>
              {leafLabel(l)}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Input ID
          <input
            className={inputClass}
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="customer_wallet"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Input label
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
          />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={useDefault}
          onChange={(e) => setUseDefault(e.target.checked)}
        />
        Supply an explicit default
      </label>
      {choice && leaf && useDefault ? (
        <ValueInput
          type={leaf.type}
          value={defaultValue}
          onChange={setDefaultValue}
          label="Explicit default value"
        />
      ) : null}
      {choice && leaf && ordered ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ValueInput
            type={leaf.type}
            value={minimum}
            onChange={setMinimum}
            label="Minimum (optional)"
          />
          <ValueInput
            type={leaf.type}
            value={maximum}
            onChange={setMaximum}
            label="Maximum (optional)"
          />
        </div>
      ) : null}
      <button type="button" className={buttonClass} onClick={add}>
        Add creation input
      </button>
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
