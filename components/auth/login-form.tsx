"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import PasskeyLogin from "./passkey-login";

export default function LoginForm({ from, error }: { from?: string; error?: string }) {
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formData: FormData) {
    setSubmitting(true);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });
    setSubmitting(false);
    if (res?.error) {
      toast.error("Invalid username or password");
      return;
    }
    window.location.href = from && from.startsWith("/") ? from : "/dashboard";
  }

  return (
    <form action={onSubmit} className="glass-panel mt-md gap-md p-md grid rounded-xl">
      {error ? (
        <p className="border-error/40 bg-error-container/30 text-label-sm text-error flex items-center gap-2 rounded border px-3 py-2 font-mono">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      ) : null}

      <Field label="Username" name="username" autoComplete="username" required />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        minLength={1}
      />

      <button
        type="submit"
        disabled={submitting}
        className="bg-primary px-md py-sm text-label-md text-on-primary mt-2 inline-flex items-center justify-center gap-2 rounded-lg font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {submitting ? "SIGNING IN…" : "SIGN IN"}
        {!submitting ? (
          <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
        ) : null}
      </button>

      <div className="text-label-sm text-outline-variant flex items-center gap-3 font-mono">
        <span className="bg-outline-variant/30 h-px flex-1" />
        OR
        <span className="bg-outline-variant/30 h-px flex-1" />
      </div>

      <PasskeyLogin from={from} />
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  minLength,
  maxLength,
  pattern,
  helper,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  helper?: string;
}) {
  return (
    <label className="group grid gap-1.5">
      <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        className="border-outline-variant/40 bg-surface-container-lowest text-on-surface placeholder:text-outline-variant focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
      />
      {helper ? (
        <span className="text-label-sm text-on-surface-variant/70 font-mono">{helper}</span>
      ) : null}
    </label>
  );
}
