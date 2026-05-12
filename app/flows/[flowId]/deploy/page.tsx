import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import DeployReview from "@/components/deploy/deploy-review";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DeployReviewPage({
  params,
}: {
  params: Promise<{ flowId: string }>;
}) {
  const user = await requireSession();
  const { flowId } = await params;
  const flow = await db.flow.findFirst({ where: { id: flowId, ownerId: user.id } });
  if (!flow) notFound();

  const graph = FlowGraphSchema.safeParse(flow.graph);
  const validation = graph.success ? validateFlow(graph.data) : null;
  const english = graph.success ? flowToEnglish(graph.data) : "(invalid graph)";

  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href={`/flows/${flow.id}`} className="text-brand-300 text-sm hover:underline">
          ← Back to canvas
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Review &amp; deploy</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Confirm the English summary below, choose a network, and sign with your wallet.
        </p>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="text-brand-400 text-[10px] tracking-wide uppercase">English preview</div>
          <p className="mt-2 text-zinc-200">{english}</p>
          <div className="mt-3 text-xs text-zinc-500">
            Template: <span className="text-brand-300 font-mono">{flow.templateKind}</span>
          </div>
        </section>

        {validation && !validation.ok && (
          <div className="mt-4 rounded border border-red-900 bg-red-950/30 p-4 text-sm text-red-200">
            <strong>Cannot deploy.</strong> The flow has validation errors:
            <ul className="mt-2 list-inside list-disc">
              {validation.errors.map((e, i) => (
                <li key={i}>
                  <code className="text-xs">{e.path}</code> — {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {validation?.ok && <DeployReview flowId={flow.id} enableMainnet={env().ENABLE_MAINNET} />}
      </main>
    </>
  );
}
