import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import Topbar from "@/components/app/topbar";
import BuilderClient from "@/components/builder/builder-client";
import { FlowGraphSchema } from "@/lib/flows/schema";

export const dynamic = "force-dynamic";

export default async function FlowBuilderPage({ params }: { params: Promise<{ flowId: string }> }) {
  const user = await requirePageSession();
  const { flowId } = await params;
  const flow = await db.flow.findFirst({ where: { id: flowId, ownerId: user.id } });
  if (!flow) notFound();

  const graph = FlowGraphSchema.safeParse(flow.graph);
  return (
    <>
      <Topbar username={user.username} />
      <BuilderClient
        flowId={flow.id}
        initialName={flow.name}
        initialGraph={graph.success ? graph.data : { nodes: [], edges: [] }}
        network={env().STELLAR_NETWORK}
      />
    </>
  );
}
