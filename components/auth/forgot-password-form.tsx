"use client";

import { useState } from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-toast";

type SubmitState = "idle" | "submitting" | "sent";

export default function ForgotPasswordForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setState("submitting");
    setMessage(null);
    const email = String(formData.get("email") ?? "").trim();
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) {
          toastError(body, "Too many requests. Try again later.");
        } else if (res.status === 422) {
          toastError(body, "Enter a valid email address.");
        } else {
          toastError(body, "Couldn't send the reset email.");
        }
        setState("idle");
        return;
      }

      setMessage(body?.data?.message ?? "Reset link sent if the email is registered.");
      setState("sent");
    } catch {
      toast.error("Network error. Please try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <div className="glass-panel mt-md p-md gap-sm grid rounded-xl">
        <p className="text-label-sm text-secondary flex items-center gap-2 font-mono">
          <span className="material-symbols-outlined text-[14px]">mark_email_read</span>
          CHECK YOUR INBOX
        </p>
        <p className="text-body-md text-on-surface">{message}</p>
        <p className="text-label-sm text-on-surface-variant/80 font-mono">
          The link expires in 60 minutes. Didn&apos;t get it? Check spam, or wait a moment and{" "}
          <button
            type="button"
            onClick={() => {
              setState("idle");
              setMessage(null);
            }}
            className="text-primary hover:text-primary-fixed underline-offset-4 hover:underline"
          >
            try again
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="glass-panel mt-md gap-md p-md grid rounded-xl">
      <label className="group grid gap-1.5">
        <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
          Email
        </span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="border-outline-variant/40 bg-surface-container-lowest text-on-surface placeholder:text-outline-variant focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={state === "submitting"}
        className="bg-primary px-md py-sm text-label-md text-on-primary mt-2 inline-flex items-center justify-center gap-2 rounded-lg font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {state === "submitting" ? "SENDING…" : "SEND RESET LINK"}
        {state !== "submitting" ? (
          <span className="material-symbols-outlined text-[16px]">send</span>
        ) : null}
      </button>
    </form>
  );
}
