"use client";

import { useState } from "react";
import { toast } from "sonner";

type AdminUser = {
  id: string;
  username: string;
  role: "ADMIN" | "USER";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  lockedUntil: string | null;
};

export default function AdminUserList({ initial }: { initial: AdminUser[] }) {
  const [users, setUsers] = useState<AdminUser[]>(initial);
  const [showCreate, setShowCreate] = useState(false);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      toast.error(b?.error?.message ?? "Failed");
      return;
    }
    toast.success("Updated.");
    setUsers((u) =>
      u.map((x) =>
        x.id === id
          ? {
              ...x,
              ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
              ...(body.role ? { role: body.role as AdminUser["role"] } : {}),
              ...(body.unlock ? { lockedUntil: null } : {}),
            }
          : x,
      ),
    );
  }

  async function create(form: FormData) {
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
        role: String(form.get("role") ?? "USER"),
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast.error(body?.error?.message ?? "Failed");
      return;
    }
    toast.success("Created.");
    setShowCreate(false);
    window.location.reload();
  }

  return (
    <>
      <div className="mt-md flex justify-end">
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95"
        >
          <span className="material-symbols-outlined text-[16px]">
            {showCreate ? "close" : "person_add"}
          </span>
          {showCreate ? "CANCEL" : "NEW USER"}
        </button>
      </div>
      {showCreate && (
        <form
          action={create}
          className="glass-panel mt-md grid grid-cols-[1fr_1fr_120px_auto] gap-2 rounded-xl p-3"
        >
          <input name="username" placeholder="username" className="admin-input" required />
          <input
            name="password"
            placeholder="password (12+)"
            type="password"
            minLength={12}
            className="admin-input"
            required
          />
          <select name="role" className="admin-input">
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button className="bg-primary text-label-sm text-on-primary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95">
            <span className="material-symbols-outlined text-[14px]">check</span>
            CREATE
          </button>
          <style jsx>{`
            :global(.admin-input) {
              background-color: #0e0e0e;
              border: 1px solid rgba(92, 63, 70, 0.4);
              padding: 0.45rem 0.65rem;
              border-radius: 0.125rem;
              font-family: "JetBrains Mono", ui-monospace, monospace;
              font-size: 13px;
              color: #e5e2e1;
            }
            :global(.admin-input:focus) {
              outline: none;
              border-color: #ffb1c4;
              box-shadow: 0 0 0 1px #ffb1c4;
            }
          `}</style>
        </form>
      )}

      <div className="glass-panel mt-md overflow-hidden rounded-xl">
        <div className="bg-surface-container/60 px-md text-label-sm text-on-surface-variant grid grid-cols-[1.5fr_120px_80px_80px_120px_1fr] gap-3 py-2.5 font-mono">
          <span>USERNAME</span>
          <span>ROLE</span>
          <span>ACTIVE</span>
          <span>LOCKED</span>
          <span>CREATED</span>
          <span>ACTIONS</span>
        </div>
        <div className="divide-outline-variant/10 divide-y">
          {users.map((u) => (
            <div
              key={u.id}
              className="px-md text-body-md hover:bg-surface-container-high/40 grid grid-cols-[1.5fr_120px_80px_80px_120px_1fr] items-center gap-3 py-2 transition-colors"
            >
              <span className="text-on-surface truncate">{u.username}</span>
              <select
                value={u.role}
                onChange={(e) => patch(u.id, { role: e.target.value })}
                className="admin-input"
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
              <span
                className={`text-label-sm inline-flex w-fit rounded border px-1.5 py-0.5 font-mono ${
                  u.isActive
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-outline-variant/40 text-on-surface-variant"
                }`}
              >
                {u.isActive ? "YES" : "NO"}
              </span>
              <span
                className={`text-label-sm inline-flex w-fit rounded border px-1.5 py-0.5 font-mono ${
                  u.lockedUntil
                    ? "border-error/40 bg-error-container/30 text-error"
                    : "border-outline-variant/40 text-on-surface-variant"
                }`}
              >
                {u.lockedUntil ? "YES" : "NO"}
              </span>
              <span className="text-label-sm text-on-surface-variant font-mono">
                {new Date(u.createdAt).toLocaleDateString()}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => patch(u.id, { isActive: !u.isActive })}
                  className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface rounded border px-2 py-0.5 font-mono transition-colors"
                >
                  {u.isActive ? "DEACTIVATE" : "ACTIVATE"}
                </button>
                {u.lockedUntil && (
                  <button
                    onClick={() => patch(u.id, { unlock: true })}
                    className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface rounded border px-2 py-0.5 font-mono transition-colors"
                  >
                    UNLOCK
                  </button>
                )}
                <button
                  onClick={() => {
                    const pw = prompt("New password (min 12 chars):");
                    if (pw && pw.length >= 12) patch(u.id, { resetPassword: pw });
                  }}
                  className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface rounded border px-2 py-0.5 font-mono transition-colors"
                >
                  RESET PW
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
