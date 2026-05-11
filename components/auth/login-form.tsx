"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

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
    <form
      action={onSubmit}
      className="mt-6 grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6"
    >
      {error ? (
        <p className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>
      ) : null}
      <label className="grid gap-1">
        <span className="text-sm text-zinc-400">Username</span>
        <input
          name="username"
          autoComplete="username"
          required
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-zinc-400">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={1}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 focus:border-brand-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-500 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
