import { notFound } from "next/navigation";
import { TemplateKind } from "@prisma/client";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env, soroswapRouterAddress } from "@/lib/env";
import { serverFeatures } from "@/lib/features";
import { FlowGraphSchema, migrateFlowGraph, sandboxNotifications } from "@/lib/flows/schema";
import { getWasmHash } from "@/lib/stellar/config";
import Topbar from "@/components/app/topbar";
import BuilderClient from "@/components/builder/builder-client";
import { executionArtifactsFromHashes } from "@/components/builder/field-policy.utils";

export const dynamic = "force-dynamic";

export default async function FlowBuilderPage({ params }: { params: Promise<{ flowId: string }> }) {
  const user = await requirePageSession();
  const account = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
  const { flowId } = await params;
  const flow = await db.flow.findFirst({ where: { id: flowId, ownerId: user.id } });
  if (!flow) notFound();

  const graph = FlowGraphSchema.safeParse(migrateFlowGraph(flow.graph));
  const hashes = new Map(
    await Promise.all(
      [TemplateKind.DEPOSIT_TRIGGER, TemplateKind.PAYER, TemplateKind.SPLITTER].map(
        async (kind) => [kind, (await getWasmHash(kind)) ?? ""] as const,
      ),
    ),
  );
  return (
    <>
      <Topbar username={user.username} />
      <BuilderClient
        flowId={flow.id}
        initialName={flow.name}
        initialGraph={
          graph.success
            ? user.role === "SANDBOX"
              ? sandboxNotifications(graph.data)
              : graph.data
            : { nodes: [], edges: [] }
        }
        sandbox={user.role === "SANDBOX"}
        accountEmail={account?.email}
        network={env().STELLAR_NETWORK}
        routerContractId={soroswapRouterAddress()}
        features={serverFeatures()}
        executionArtifacts={executionArtifactsFromHashes(hashes)}
      />
    </>
  );
}
