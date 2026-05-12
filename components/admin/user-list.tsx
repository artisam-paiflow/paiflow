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
    toast.success("Updated");
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
    toast.success("Created");
    setShowCreate(false);
    window.location.reload();
  }

  return (
    <>
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="bg-brand-600 hover:bg-brand-500 rounded px-3 py-1.5 text-sm"
        >
          {showCreate ? "Cancel" : "New user"}
        </button>
      </div>
      {showCreate && (
        <form
          action={create}
          className="mt-4 grid grid-cols-[1fr_1fr_120px_auto] gap-2 rounded border border-zinc-800 bg-zinc-950 p-3 text-sm"
        >
          <input name="username" placeholder="username" className="input" required />
          <input
            name="password"
            placeholder="password (12+)"
            type="password"
            minLength={12}
            className="input"
            required
          />
          <select name="role" className="input">
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button className="bg-brand-600 hover:bg-brand-500 rounded px-3 py-1">Create</button>
          <style jsx>{`
            :global(.input) {
              background-color: #0a0a0f;
              border: 1px solid #27272a;
              padding: 0.4rem 0.6rem;
              border-radius: 0.375rem;
            }
          `}</style>
        </form>
      )}
      <table className="mt-6 w-full text-left text-sm">
        <thead className="bg-zinc-950 text-zinc-400">
          <tr>
            <th className="px-3 py-2">Username</th>
            <th className="px-3 py-2">Role</th>
            <th className="px-3 py-2">Active</th>
            <th className="px-3 py-2">Locked</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-3 py-2">{u.username}</td>
              <td className="px-3 py-2">
                <select
                  value={u.role}
                  onChange={(e) => patch(u.id, { role: e.target.value })}
                  className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </td>
              <td className="px-3 py-2">{u.isActive ? "yes" : "no"}</td>
              <td className="px-3 py-2">{u.lockedUntil ? "yes" : "no"}</td>
              <td className="px-3 py-2 text-zinc-400">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
              <td className="space-x-2 px-3 py-2">
                <button
                  onClick={() => patch(u.id, { isActive: !u.isActive })}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-900"
                >
                  {u.isActive ? "Deactivate" : "Activate"}
                </button>
                {u.lockedUntil && (
                  <button
                    onClick={() => patch(u.id, { unlock: true })}
                    className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-900"
                  >
                    Unlock
                  </button>
                )}
                <button
                  onClick={() => {
                    const pw = prompt("New password (min 12 chars):");
                    if (pw && pw.length >= 12) patch(u.id, { resetPassword: pw });
                  }}
                  className="rounded border border-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-900"
                >
                  Reset password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
