import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdminTemplates() {
  const user = await requireSession({ role: Role.ADMIN });
  const templates = await db.contractTemplate.findMany({
    orderBy: [{ network: "asc" }, { kind: "asc" }],
  });
  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Contract templates</h1>
        <p className="mt-2 text-sm text-zinc-400">
          These are the pre-uploaded Soroban WASMs that Pink Raft instantiates when you deploy a
          flow. Re-upload via{" "}
          <code className="rounded bg-zinc-900 px-1">pnpm contracts:upload</code>.
        </p>
        <table className="mt-6 w-full text-left text-sm">
          <thead className="bg-zinc-950 text-zinc-400">
            <tr>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Network</th>
              <th className="px-3 py-2">WASM hash</th>
              <th className="px-3 py-2">Uploaded</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {templates.map((t) => (
              <tr key={t.id}>
                <td className="px-3 py-2">{t.kind}</td>
                <td className="px-3 py-2">{t.network}</td>
                <td className="px-3 py-2 font-mono text-xs">{t.wasmHash}</td>
                <td className="px-3 py-2 text-zinc-400">
                  {new Date(t.uploadedAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No templates registered. Run <code>pnpm contracts:upload</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>
    </>
  );
}
