import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import DeploymentView from "@/components/deploy/deployment-view";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { sep7InvokeUri } from "@/lib/stellar/sep7";

export const dynamic = "force-dynamic";

export default async function DeploymentPage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const user = await requireSession();
  const { deploymentId } = await params;
  const d = await db.deployment.findFirst({
    where: { id: deploymentId, ownerId: user.id },
    include: {
      flow: { select: { name: true, templateKind: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!d) notFound();

  const graph = FlowGraphSchema.parse(d.graphSnapshot);

  const invokeUri =
    d.contractAddress && d.flow.templateKind === "SPLITTER"
      ? sep7InvokeUri({
          destination: d.contractAddress,
          function: "distribute",
          paramName: "amount",
          paramType: "i128",
          message: "Trigger splitter distribution",
        })
      : null;

  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/dashboard" className="text-brand-300 text-sm hover:underline">
          ← Back
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{d.flow.name}</h1>
        <div className="mt-1 text-sm text-zinc-400">
          {d.flow.templateKind} · {d.network} · status{" "}
          <span className="text-brand-300 font-mono">{d.status}</span>
        </div>

        <DeploymentView
          deploymentId={d.id}
          contractAddress={d.contractAddress}
          status={d.status}
          invokeUri={invokeUri}
          graph={graph}
          initialEvents={d.events.map((e) => ({
            id: e.id,
            kind: e.kind,
            ledger: e.ledger,
            txHash: e.txHash,
            payload: e.payload,
            occurredAt: e.occurredAt.toISOString(),
          }))}
        />
      </main>
    </>
  );
}
