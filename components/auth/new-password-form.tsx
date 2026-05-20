"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type SubmitState = "idle" | "submitting" | "done";

export default function NewPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>("idle");

  if (!token) {
    return (
      <div className="glass-panel mt-md p-md gap-sm grid rounded-xl">
        <p className="text-label-sm text-error flex items-center gap-2 font-mono">
          <span className="material-symbols-outlined text-[14px]">error</span>
          MISSING TOKEN
        </p>
        <p className="text-body-md text-on-surface">
          This password-reset link is incomplete. Request a new one from the{" "}
          <a
            href="/forgot-password"
            className="text-primary hover:text-primary-fixed underline-offset-4 hover:underline"
          >
            forgot password
          </a>{" "}
          page.
        </p>
      </div>
    );
  }

  async function onSubmit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    if (password.length < 12) {
      toast.error("Password must be at least 12 characters.");
      return;
    }

    setState("submitting");
    try {
      const res = await fetch("/api/auth/new-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(body?.error?.message ?? "Couldn't update password.");
        setState("idle");
        return;
      }

      setState("done");
      toast.success(body?.data?.message ?? "Password updated.");
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      toast.error("Network error. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="glass-panel mt-md p-md gap-sm grid rounded-xl">
        <p className="text-label-sm text-secondary flex items-center gap-2 font-mono">
          <span className="material-symbols-outlined text-[14px]">check_circle</span>
          PASSWORD UPDATED
        </p>
        <p className="text-body-md text-on-surface">Redirecting you to the sign-in page…</p>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="glass-panel mt-md gap-md p-md grid rounded-xl">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        helper="At least 12 characters."
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={12}
      />

      <button
        type="submit"
        disabled={state === "submitting"}
        className="bg-primary px-md py-sm text-label-md text-on-primary mt-2 inline-flex items-center justify-center gap-2 rounded-lg font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {state === "submitting" ? "UPDATING…" : "UPDATE PASSWORD"}
        {state !== "submitting" ? (
          <span className="material-symbols-outlined text-[16px]">key</span>
        ) : null}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  minLength,
  helper,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
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
        required
        minLength={minLength}
        className="border-outline-variant/40 bg-surface-container-lowest text-on-surface placeholder:text-outline-variant focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
      />
      {helper ? (
        <span className="text-label-sm text-on-surface-variant/70 font-mono">{helper}</span>
      ) : null}
    </label>
  );
}
