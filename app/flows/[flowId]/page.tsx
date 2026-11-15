import { notFound } from "next/navigation";
import { TemplateKind } from "@prisma/client";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env, soroswapRouterAddress } from "@/lib/env";
import { serverFeatures } from "@/lib/features";
import { OrdinaryFlowGraphSchema } from "@/lib/flows/ordinary-schema";
import { ordinarySandboxNotifications } from "@/lib/flows/ordinary-flow";
import { getConditionalWasmHashes } from "@/lib/stellar/conditional-artifact-config";
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

  const graph = OrdinaryFlowGraphSchema.safeParse(flow.graph);
  // A malformed explicit generation must never become an empty legacy draft
  // that autosave could write over the retained conditional metadata.
  if (
    !graph.success &&
    flow.graph !== null &&
    typeof flow.graph === "object" &&
    !Array.isArray(flow.graph) &&
    ("generation" in flow.graph || "conditionalPolicies" in flow.graph)
  )
    notFound();
  const hashes = new Map(
    await Promise.all(
      [
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.PAYER,
        TemplateKind.SPLITTER,
        TemplateKind.ROUTER,
      ].map(async (kind) => [kind, (await getWasmHash(kind)) ?? ""] as const),
    ),
  );
  const conditionalHashes = await getConditionalWasmHashes().catch(
    () => new Map<TemplateKind, string>(),
  );
  return (
    <>
      <Topbar username={user.username} />
      <BuilderClient
        allowConditional
        conditionalArtifactHashes={Object.fromEntries(conditionalHashes)}
        flowId={flow.id}
        initialName={flow.name}
        initialGraph={
          graph.success
            ? user.role === "SANDBOX"
              ? ordinarySandboxNotifications(graph.data)
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
