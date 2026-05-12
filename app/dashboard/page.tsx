import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireSession();
  const [flows, deployments] = await Promise.all([
    db.flow.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    db.deployment.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { flow: { select: { name: true } } },
    }),
  ]);

  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Your flows</h1>
          <Link
            href="/flows/new"
            className="rounded-md bg-brand-600 px-4 py-2 font-medium hover:bg-brand-500"
          >
            New flow
          </Link>
        </div>

        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {flows.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-zinc-800 p-10 text-center text-zinc-400">
              No flows yet. Click <strong>New flow</strong> to drag your first one.
            </div>
          ) : (
            flows.map((f) => (
              <Link
                key={f.id}
                href={`/flows/${f.id}`}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 hover:border-brand-500"
              >
                <div className="text-xs uppercase tracking-wide text-brand-400">
                  {f.templateKind}
                </div>
                <div className="mt-1 truncate text-lg font-medium">{f.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Updated {new Date(f.updatedAt).toLocaleString()}
                </div>
              </Link>
            ))
          )}
        </section>

        <h2 className="mt-12 text-xl font-semibold">Recent deployments</h2>
        <section className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
          {deployments.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">No deployments yet.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-950 text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Flow</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Network</th>
                  <th className="px-4 py-2">Contract</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900">
                {deployments.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2">
                      <Link
                        href={`/deployments/${d.id}`}
                        className="text-brand-300 hover:underline"
                      >
                        {d.flow.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{d.status}</td>
                    <td className="px-4 py-2">{d.network}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {d.contractAddress ? d.contractAddress.slice(0, 16) + "…" : "—"}
                    </td>
                    <td className="px-4 py-2">{new Date(d.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
