"use client";

import { useEffect, useId, useRef } from "react";
import type { FlowGraph } from "@/lib/flows/schema";
import { isValidEmailAddress } from "@/lib/flows/schema";
import { Field } from "./inputs/field";
import { inputClass } from "./inputs/styles";

export function RecipientEmailField({
  value,
  onChange,
  label = "Recipient email (optional)",
  shared = false,
}: {
  value?: string;
  onChange: (email: string) => void;
  label?: string;
  /** Standard builder forms opt in; excluded forms and notification settings keep their presentation. */
  shared?: boolean;
}) {
  const id = useId();
  const invalid = !!value?.trim() && !isValidEmailAddress(value.trim());
  if (shared) {
    return (
      <Field
        label={label}
        error={invalid ? "Enter a valid email address or leave it empty." : null}
      >
        {(control) => (
          <input
            {...control}
            type="email"
            maxLength={254}
            className={inputClass}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Field>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-on-surface-variant text-body-sm">
        {label}
      </label>
      <input
        id={id}
        type="email"
        maxLength={254}
        className="input border-outline-variant/50 bg-surface-container-lowest text-on-surface min-h-11 w-full rounded-lg border px-3 py-2"
        value={value ?? ""}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <p id={`${id}-error`} className="text-error text-body-sm">
          Enter a valid email address or leave it empty.
        </p>
      )}
    </div>
  );
}

export function NotificationSettings({
  value,
  onChange,
}: {
  value: NonNullable<FlowGraph["notify"]>;
  onChange: (notify: NonNullable<FlowGraph["notify"]>) => void;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-4">
      <legend className="text-on-surface mb-4 font-semibold">Owner notifications</legend>
      <div className="space-y-2">
        <label htmlFor={`${id}-mode`} className="text-on-surface-variant text-body-sm">
          Notify me
        </label>
        <select
          id={`${id}-mode`}
          className="input border-outline-variant/50 bg-surface-container-lowest text-on-surface min-h-11 w-full rounded-lg border px-3 py-2"
          value={value.mode}
          onChange={(e) =>
            onChange({ ...value, mode: e.target.value as NonNullable<FlowGraph["notify"]>["mode"] })
          }
        >
          <option value="every_transaction">Every time money moves</option>
          <option value="shortfalls_only">Only when a deposit falls short</option>
          <option value="off">Off</option>
        </select>
        <p className="text-on-surface-variant text-body-sm">
          {value.mode === "off"
            ? "Email notifications are turned off for this flow."
            : value.mode === "shortfalls_only"
              ? "Get an alert when a deposit is less than the flow needs."
              : "Receive one summary each time money moves through this flow."}
        </p>
      </div>
      <div className="bg-surface-container-low border-outline-variant/40 space-y-2 rounded-xl border p-4">
        <RecipientEmailField
          label="Send to"
          value={value.sendTo}
          onChange={(sendTo) => onChange({ ...value, sendTo })}
        />
        {!value.sendTo.trim() && (
          <p className="text-on-surface-variant text-body-sm">Add an email to get notified</p>
        )}
      </div>
    </fieldset>
  );
}

export function NotificationSettingsDialog({
  value,
  onChange,
  onClose,
}: {
  value: NonNullable<FlowGraph["notify"]>;
  onChange: (notify: NonNullable<FlowGraph["notify"]>) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const pointerStartedOutside = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    heading.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onPointerDown={(e) => {
        pointerStartedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerStartedOutside.current) onClose();
        pointerStartedOutside.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="text-on-surface fixed inset-0 m-0 flex h-dvh max-h-none w-full max-w-none items-end justify-center border-0 bg-transparent p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm md:items-center md:p-6"
    >
      <div className="border-outline-variant/50 bg-surface flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border shadow-2xl md:max-w-[var(--container-md)] md:rounded-2xl">
        <div className="border-outline-variant/40 flex items-start gap-3 border-b p-5 md:p-6">
          <span
            aria-hidden="true"
            className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl"
          >
            <span className="material-symbols-outlined">mail</span>
          </span>
          <div className="min-w-0 flex-1">
            <h2 ref={heading} id={titleId} tabIndex={-1} className="text-title-lg font-semibold">
              Email notifications
            </h2>
            <p id={descriptionId} className="text-on-surface-variant text-body-sm mt-1">
              Choose when this flow emails you.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors"
            onClick={onClose}
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              close
            </span>
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 md:p-6">
          <NotificationSettings value={value} onChange={onChange} />
        </div>
        <div className="border-outline-variant/40 bg-surface-container-low flex items-center justify-between gap-4 border-t px-5 py-4 md:px-6">
          <p className="text-on-surface-variant text-body-sm">
            Email settings never block deployment.
          </p>
          <button
            type="button"
            className="bg-primary text-on-primary text-label-lg hover:bg-primary/90 min-h-11 shrink-0 rounded-xl px-6 font-semibold transition-colors"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
