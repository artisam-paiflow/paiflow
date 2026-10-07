import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { projectPublicEmbed } from "@/lib/deployments/public-embed";
import PublicDeploymentView from "@/components/deploy/public-deployment-view";
import Logo from "@/components/app/logo";

export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: { params: Promise<{ deploymentId: string }> }) {
  const { deploymentId } = await params;
  if (!z.string().uuid().safeParse(deploymentId).success) notFound();
  // Do not load webhook credentials, owner records, tokens, or pipeline metadata.
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    select: {
      id: true,
      status: true,
      contractAddress: true,
      network: true,
      graphSnapshot: true,
      events: {
        orderBy: [{ ledger: "desc" }, { eventId: "desc" }],
        take: 50,
        select: {
          eventId: true,
          kind: true,
          ledger: true,
          txHash: true,
          decodedData: true,
          occurredAt: true,
        },
      },
    },
  });
  const data = deployment ? projectPublicEmbed(deployment) : null;
  if (!data) notFound();

  return (
    <main className="px-margin py-md mx-auto max-w-4xl">
      <div className="mb-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
        <Logo size={18} />
        <span className="text-outline-variant">·</span>
        <span>EMBED</span>
      </div>
      <PublicDeploymentView data={data} />
    </main>
  );
}
