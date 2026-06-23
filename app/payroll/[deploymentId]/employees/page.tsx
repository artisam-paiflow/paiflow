import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import Topbar from "@/components/app/topbar";
import EmployeeManager from "@/components/payroll/employee-manager";
import { assetLabel, type Asset } from "@/lib/flows/schema";

export default async function PayrollEmployeesPage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const user = await requireSession();
  const { deploymentId } = await params;

  const deployment = await db.deployment.findFirst({
    where: { id: deploymentId, ownerId: user.id },
    include: { flow: { select: { templateKind: true } } },
  });

  if (!deployment || deployment.flow.templateKind !== "PAYROLL") {
    notFound();
  }

  const graph = deployment.graphSnapshot as {
    nodes: Array<{ type: string; config?: { asset?: Asset } }>;
  };
  const triggerNode = graph.nodes.find((n) => n.type === "payroll");
  const asset: Asset = (triggerNode?.config?.asset ?? { kind: "known", symbol: "USDC" }) as Asset;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Topbar username={user.username} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-headline-sm text-on-surface">Payroll employees</h1>
            <p className="text-body-md text-on-surface-variant mt-1">
              Manage {assetLabel(asset)} salary recipients for deployment{" "}
              <span className="font-mono">{deploymentId.slice(0, 8)}</span>.
            </p>
          </div>
          <Link
            href={`/deployments/${deploymentId}`}
            className="text-secondary hover:text-secondary/80 font-mono text-xs"
          >
            ← BACK TO DEPLOYMENT
          </Link>
        </div>

        <section className="glass-panel rounded-xl p-6">
          <EmployeeManager deploymentId={deploymentId} asset={asset} />
        </section>
      </main>
    </div>
  );
}
