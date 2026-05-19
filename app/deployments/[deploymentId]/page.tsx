import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import DeploymentView from "@/components/deploy/deployment-view";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";

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

  const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
  const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
  const asset = trigger?.type === "on_receive" ? trigger.config.asset : { kind: "native" as const };

  const sep7 = d.contractAddress
    ? sep7PaymentUri({
        destination: d.contractAddress,
        asset,
        message: "Pink Raft deployment",
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
          sep7Uri={sep7}
          network={d.network}
          templateKind={d.flow.templateKind}
          graph={graph.success ? graph.data : null}
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
