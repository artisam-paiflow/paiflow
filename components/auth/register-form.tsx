"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function RegisterForm() {
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(formData: FormData) {
    setSubmitting(true);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? "Registration failed");
      return;
    }
    toast.success("Account created. Please sign in.");
    window.location.href = "/login";
  }

  return (
    <form
      action={onSubmit}
      className="mt-6 grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6"
    >
      <label className="grid gap-1">
        <span className="text-sm text-zinc-400">Username</span>
        <input
          name="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[a-zA-Z0-9_.\-]+"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm text-zinc-400">Password (min 12 chars)</span>
        <input
          type="password"
          name="password"
          required
          minLength={12}
          maxLength={256}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="bg-brand-600 hover:bg-brand-500 rounded-md px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {submitting ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
