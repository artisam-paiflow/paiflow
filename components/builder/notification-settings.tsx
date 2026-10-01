"use client";

import { useEffect, useId, useRef } from "react";
import type { FlowGraph } from "@/lib/flows/schema";
import { isValidEmailAddress } from "@/lib/flows/schema";

export function RecipientEmailField({
  value,
  onChange,
  label = "Recipient email (optional)",
}: {
  value?: string;
  onChange: (email: string) => void;
  label?: string;
}) {
  const id = useId();
  const invalid = !!value?.trim() && !isValidEmailAddress(value.trim());
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-on-surface-variant text-body-sm">
        {label}
      </label>
      <input
        id={id}
        type="email"
        maxLength={254}
        className="input min-h-11 w-full"
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
    <fieldset className="space-y-3">
      <legend className="text-on-surface font-semibold">Owner notifications</legend>
      <label htmlFor={`${id}-mode`} className="text-on-surface-variant text-body-sm">
        Notify me
      </label>
      <select
        id={`${id}-mode`}
        className="input min-h-11 w-full"
        value={value.mode}
        onChange={(e) =>
          onChange({ ...value, mode: e.target.value as NonNullable<FlowGraph["notify"]>["mode"] })
        }
      >
        <option value="every_transaction">Every time money moves</option>
        <option value="shortfalls_only">Only when a deposit falls short</option>
        <option value="off">Off</option>
      </select>
      <RecipientEmailField
        label="Send to"
        value={value.sendTo}
        onChange={(sendTo) => onChange({ ...value, sendTo })}
      />
      {!value.sendTo.trim() && (
        <p className="text-on-surface-variant text-body-sm">Add an email to get notified</p>
      )}
      <p className="text-on-surface-variant text-body-sm">
        One summary per transaction. Email settings never block deployment.
      </p>
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
  useEffect(() => {
    dialog.current?.showModal();
    heading.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="border-outline-variant bg-surface text-on-surface fixed inset-x-0 top-auto bottom-0 m-0 max-h-[80dvh] w-full overflow-auto rounded-t-xl border p-4 shadow-xl backdrop:bg-black/50 md:inset-0 md:m-auto md:w-96 md:rounded-xl"
    >
      <h2 ref={heading} id={titleId} tabIndex={-1} className="text-title-lg mb-3">
        Email notifications
      </h2>
      <NotificationSettings value={value} onChange={onChange} />
      <button type="button" className="input mt-3 min-h-11" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
