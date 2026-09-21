"use client";

import { useId } from "react";
import { errorClass, hintClass, labelClass } from "./styles";

export type FieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

export function useField({
  hint,
  note,
  error,
}: {
  hint?: React.ReactNode;
  note?: string | null;
  error?: string | null;
}) {
  const base = useId();
  const controlId = `${base}-control`;
  const labelId = `${base}-label`;
  const hintId = `${base}-hint`;
  const noteId = `${base}-note`;
  const errorId = `${base}-error`;
  const describedBy = [hint ? hintId : null, note ? noteId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  const controlProps: FieldControlProps = {
    id: controlId,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  };
  return { controlId, labelId, hintId, noteId, errorId, controlProps };
}

type CommonProps = {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /**
   * What the control just did to the user's input — a refused keystroke, a
   * clamp on blur. Polite and always mounted, like the error, so it is
   * announced once when it changes.
   */
  note?: string | null;
  error?: string | null;
};

type FieldProps =
  | (CommonProps & {
      group?: false;
      /** Spread the props onto the one control this field labels. */
      children: (control: FieldControlProps) => React.ReactNode;
    })
  | (CommonProps & {
      /**
       * Several controls under one label. The label names the group, not its
       * first child, so each child carries its own accessible name.
       */
      group: true;
      children: React.ReactNode;
    });

/**
 * A label, a hint and an error wired to their control: `htmlFor`,
 * `aria-invalid`, `aria-describedby`. The error region is always mounted and
 * polite, so a message that appears while typing is announced once when it
 * changes, not on every keystroke, and it stays out of the control's name.
 */
export function Field(props: FieldProps) {
  const { label, hint, note, error } = props;
  const { controlId, labelId, hintId, noteId, errorId, controlProps } = useField({
    hint,
    note,
    error,
  });

  return (
    <div className="group grid gap-1">
      {props.group ? (
        <>
          <span id={labelId} className={labelClass}>
            {label}
          </span>
          <div
            role="group"
            aria-labelledby={labelId}
            aria-describedby={controlProps["aria-describedby"]}
            aria-invalid={controlProps["aria-invalid"]}
            className="grid gap-1"
          >
            {props.children}
          </div>
        </>
      ) : (
        <>
          <label id={labelId} htmlFor={controlId} className={labelClass}>
            {label}
          </label>
          {props.children(controlProps)}
        </>
      )}
      {hint && (
        <div id={hintId} className={hintClass}>
          {hint}
        </div>
      )}
      <p id={noteId} aria-live="polite" className={note ? hintClass : "sr-only"}>
        {note ?? ""}
      </p>
      <p id={errorId} aria-live="polite" className={error ? errorClass : "sr-only"}>
        {error ?? ""}
      </p>
    </div>
  );
}
