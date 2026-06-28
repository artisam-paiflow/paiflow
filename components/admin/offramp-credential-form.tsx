"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

type Credential = {
  provider: string;
  username: string;
  accessToken: string;
  idToken?: string | null;
  apiUrl?: string | null;
  expiresAt?: string | null;
  updatedAt?: string;
  hasAccessToken?: boolean;
  hasIdToken?: boolean;
};

const EMPTY: Credential = {
  provider: "pdax",
  username: "",
  accessToken: "",
  idToken: "",
  apiUrl: "",
  expiresAt: "",
};

export default function OffRampCredentialForm() {
  const [cred, setCred] = useState<Credential>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/offramp-credentials")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load credentials");
        const json = (await res.json()) as { data: { credential: Credential | null } };
        if (json.data.credential) {
          const { accessToken, idToken, ...safe } = json.data.credential;
          setCred({ ...EMPTY, ...safe });
          if (safe.hasAccessToken || safe.hasIdToken) {
            toast.info("Credentials are saved. Re-enter tokens only if you want to update them.");
          }
        }
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to load credentials"),
      )
      .finally(() => setLoading(false));
  }, []);

  const update = (patch: Partial<Credential>) => {
    setCred((prev) => ({ ...prev, ...patch }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cred.username.trim() || !cred.accessToken.trim()) {
      toast.error("Username and access token are required");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/offramp-credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: cred.username,
          accessToken: cred.accessToken,
          idToken: cred.idToken || null,
          apiUrl: cred.apiUrl || null,
          expiresAt: cred.expiresAt || null,
        }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? "Failed to save credentials");
      }
      toast.success("PDAX credentials saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-on-surface-variant py-4 text-center font-mono text-xs">
        Loading credentials…
      </div>
    );
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Username" value={cred.username} onChange={(v) => update({ username: v })} />
        <Field
          label="API URL (optional)"
          value={cred.apiUrl ?? ""}
          onChange={(v) => update({ apiUrl: v })}
          placeholder="https://api.pdax.ph"
        />
      </div>
      <Field
        label="Access token"
        value={cred.accessToken}
        onChange={(v) => update({ accessToken: v })}
        type="password"
      />
      <Field
        label="ID token"
        value={cred.idToken ?? ""}
        onChange={(v) => update({ idToken: v })}
        type="password"
      />
      <Field
        label="Expires at (ISO, optional)"
        value={cred.expiresAt ?? ""}
        onChange={(v) => update({ expiresAt: v })}
        placeholder="2026-06-25T12:00:00.000Z"
      />

      {cred.updatedAt && (
        <p className="text-on-surface-variant font-mono text-xs">
          Last updated: {new Date(cred.updatedAt).toLocaleString()}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="bg-primary text-on-primary hover:bg-primary/90 rounded-lg px-4 py-2 font-mono text-sm disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save PDAX credentials"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-label-sm text-on-surface-variant font-mono uppercase">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-outline-variant/40 bg-surface-container text-body-md text-on-surface focus:border-primary w-full rounded-lg border px-3 py-2 outline-none"
      />
    </div>
  );
}
