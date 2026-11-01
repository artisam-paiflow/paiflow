"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { AdditionalRecipientSchema, type AdditionalRecipient } from "@/lib/flows/field-policies";
import type { Asset } from "@/lib/flows/schema";
import { Field } from "../inputs/field";
import { AmountInput } from "../inputs/amount-input";
import { ShareInput } from "../inputs/share-input";
import { inputClass } from "../inputs/styles";

/** Complete stored rows, distinct from execution arguments and configured rows. */
export function AdditionalRecipientsEditor({
  value,
  mode,
  onChange,
  max = 20,
  asset,
  disabled = false,
  commitOnApply = false,
  reservedIds = [],
  reservedRecipients = [],
}: {
  value: AdditionalRecipient[];
  mode: "fixed" | "percentage";
  onChange: (rows: AdditionalRecipient[]) => void;
  max?: number;
  asset?: Asset;
  disabled?: boolean;
  commitOnApply?: boolean;
  reservedIds?: string[];
  reservedRecipients?: string[];
}) {
  const [draft, setDraft] = useState(value),
    [dirty, setDirty] = useState(false),
    [errors, setErrors] = useState<z.ZodIssue[]>([]);
  const valueKey = JSON.stringify(value);
  useEffect(() => {
    setDraft(value);
    setDirty(false);
    setErrors([]);
  }, [valueKey, mode]);
  const rows = commitOnApply ? draft : value;
  const parse = (next: AdditionalRecipient[]) =>
    z
      .array(AdditionalRecipientSchema)
      .max(max)
      .superRefine((list, ctx) => {
        const ids = [...reservedIds, ...list.map((r) => r.rowId)],
          recipients = [...reservedRecipients, ...list.map((r) => r.recipient)];
        if (new Set(ids).size !== ids.length)
          ctx.addIssue({
            code: "custom",
            message: "Stored row identities cannot collide with configured rows.",
          });
        if (new Set(recipients).size !== recipients.length)
          ctx.addIssue({
            code: "custom",
            message: "Stored recipients must be unique, including configured recipients.",
          });
        if (list.some((r) => r.allocation.kind !== mode))
          ctx.addIssue({ code: "custom", message: "Stored allocation mode must match the Split." });
      })
      .safeParse(next);
  const update = (next: AdditionalRecipient[]) => {
    if (commitOnApply) {
      setDraft(next);
      setDirty(true);
    } else onChange(next);
    const checked = parse(next);
    setErrors(checked.success ? [] : checked.error.issues);
  };
  const controlled = parse(value);
  const shownErrors = commitOnApply ? errors : controlled.success ? [] : controlled.error.issues;
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-medium">Stored appended recipients</legend>
      {rows.map((row, index) => (
        <div key={row.rowId} className="space-y-2 rounded border border-zinc-700 p-3">
          <p className="text-xs break-all text-zinc-400">Row {row.rowId}</p>
          <Field label={`Stored recipient ${index + 1}`}>
            {(control) => (
              <input
                {...control}
                className={inputClass}
                value={row.recipient}
                autoComplete="off"
                onChange={(e) =>
                  update(
                    rows.map((r, i) => (i === index ? { ...r, recipient: e.target.value } : r)),
                  )
                }
              />
            )}
          </Field>
          {mode === "percentage" && row.allocation.kind === "percentage" ? (
            <ShareInput
              label={`Stored share ${index + 1}`}
              value={row.allocation.bps}
              onChange={(bps) =>
                update(
                  rows.map((r, i) =>
                    i === index ? { ...r, allocation: { kind: "percentage", bps } } : r,
                  ),
                )
              }
            />
          ) : row.allocation.kind === "fixed" ? (
            <AmountInput
              label={`Stored amount ${index + 1}`}
              asset={asset}
              commit="draft"
              value={row.allocation.amountStroops}
              onChange={(amountStroops) =>
                update(
                  rows.map((r, i) =>
                    i === index ? { ...r, allocation: { kind: "fixed", amountStroops } } : r,
                  ),
                )
              }
            />
          ) : (
            <p role="alert">Stored allocation must match the configured distribution mode.</p>
          )}
          <button
            type="button"
            className="min-h-11 rounded border border-zinc-600 px-3 text-sm"
            onClick={() => update(rows.filter((_, i) => i !== index))}
          >
            Remove stored recipient {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={rows.length >= max}
        className="min-h-11 rounded border border-zinc-600 px-3 text-sm disabled:opacity-50"
        onClick={() =>
          update([
            ...rows,
            {
              rowId: crypto.randomUUID(),
              recipient: "",
              allocation:
                mode === "fixed"
                  ? { kind: "fixed", amountStroops: "0" }
                  : { kind: "percentage", bps: 0 },
            },
          ])
        }
      >
        Add stored recipient
      </button>
      {shownErrors.map((issue, i) => (
        <p key={i} role="alert" className="text-error text-xs">
          {typeof issue.path[0] === "number" ? `Stored recipient ${issue.path[0] + 1}: ` : ""}
          {issue.message}
        </p>
      ))}
      {commitOnApply && (
        <>
          {dirty && (
            <p role="status" className="text-xs">
              Stored roster edits are local until you apply them. Complete each wallet and
              allocation before applying; other draft values remain saved.
            </p>
          )}
          <button
            type="button"
            className="min-h-11 rounded border border-zinc-600 px-3 text-sm disabled:opacity-50"
            disabled={!dirty}
            onClick={() => {
              const checked = parse(draft);
              if (!checked.success) {
                setErrors(checked.error.issues);
                return;
              }
              onChange(checked.data);
              setDirty(false);
              setErrors([]);
            }}
          >
            Apply stored roster to draft
          </button>
        </>
      )}
      <p className="text-xs text-zinc-400">
        Every stored row needs a valid wallet and allocation before deployment or an update.
        Configured rows keep their identities and order. Combined limit: 20 recipients.
      </p>
    </fieldset>
  );
}
