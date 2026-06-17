import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { flowToPipeline, getStreamerPreviewFromPipeline } from "@/lib/flows/to-params";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";
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
  const pipeline = validation?.ok ? validation.pipeline : null;

  let streamerPreview: {
    totalStroops: string;
    durationSecs: number;
    intervalLabel: string;
    startDate: string;
    endDate: string;
  } | null = null;
  const isSubscriptionTrigger = graph.data!.nodes.some((n) => n.type === "subscription");
  if (pipeline) {
    const sp = getStreamerPreviewFromPipeline(flowToPipeline(graph.data!));
    if (sp) {
      const triggerNode = graph.data!.nodes.find(
        (n) => n.type === "on_schedule" || n.type === "subscription",
      ) as
        | {
            type: "on_schedule" | "subscription";
            config: { intervalAmount?: number; intervalUnit?: string; interval?: string };
          }
        | undefined;
      const intervalAmount = triggerNode?.config.intervalAmount ?? 1;
      const intervalUnit =
        triggerNode?.config.intervalUnit ?? triggerNode?.config.interval ?? "hour";
      const intervalLabel =
        intervalAmount === 1 ? `every ${intervalUnit}` : `every ${intervalAmount} ${intervalUnit}s`;
      streamerPreview = {
        totalStroops: sp.totalStroops,
        durationSecs: sp.durationSecs,
        intervalLabel,
        startDate: new Date(sp.startTs * 1000).toISOString(),
        endDate: new Date(sp.endTs * 1000).toISOString(),
      };
    }
  }

  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-3xl">
        <Link
          href={`/flows/${flow.id}`}
          className="text-label-sm text-on-surface-variant hover:text-primary inline-flex items-center gap-1 font-mono transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          BACK TO CANVAS
        </Link>

        <p className="mt-md text-label-sm text-primary font-mono">/ DEPLOY · REVIEW</p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Review &amp; deploy.
        </h1>
        <p className="text-body-md text-on-surface-variant mt-3">
          Confirm the English summary below and sign with your wallet.
        </p>

        <section className="glass-panel mt-md p-md rounded-xl">
          <div className="text-label-sm text-primary flex items-center gap-2 font-mono">
            <span className="material-symbols-outlined text-[14px]">subject</span>
            ENGLISH PREVIEW
          </div>
          <p className="text-body-md text-on-surface mt-2">{english}</p>
          {pipeline && pipeline.length > 0 && (
            <div className="mt-md">
              <div className="text-label-sm text-on-surface-variant font-mono">
                PIPELINE ARCHITECTURE
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {pipeline.map((kind, i) => (
                  <span key={`${kind}-${i}`} className="inline-flex items-center gap-1.5">
                    <span className="text-label-sm border-primary/20 bg-primary/10 text-primary inline-flex items-center rounded-md border px-2 py-1 font-mono">
                      {TEMPLATE_LABELS[kind]}
                    </span>
                    {i < pipeline.length - 1 && (
                      <span className="material-symbols-outlined text-on-surface-variant text-[14px]">
                        arrow_forward
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {pipeline && pipeline.length > 1 && (
          <section className="glass-panel mt-md p-md rounded-xl">
            <div className="text-label-sm text-primary flex items-center gap-2 font-mono">
              <span className="material-symbols-outlined text-[14px]">dataset</span>
              PIPELINE PREVIEW
            </div>
            <p className="text-body-md text-on-surface-variant mt-2">
              This deployment will create{" "}
              <strong className="text-on-surface">{pipeline.length} contracts</strong> in a single
              transaction:
            </p>
            <ul className="mt-3 space-y-2">
              {pipeline.map((kind, i) => (
                <li key={`${kind}-${i}`} className="flex items-start gap-2">
                  <span className="text-label-sm text-on-surface-variant mt-0.5 font-mono">
                    {i + 1}.
                  </span>
                  <div>
                    <span className="text-label-md text-on-surface font-mono">
                      {TEMPLATE_LABELS[kind]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {streamerPreview && (
          <section className="mt-4 rounded-xl border border-amber-900 bg-amber-950/20 p-4">
            <div className="text-[10px] font-medium tracking-wide text-amber-400 uppercase">
              {isSubscriptionTrigger ? "Subscription schedule" : "Streamer funding required"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-zinc-400">
                  {isSubscriptionTrigger ? "Total pull amount" : "Total vest amount"}
                </div>
                <div className="font-mono text-lg text-amber-200">
                  {(Number(streamerPreview.totalStroops) / 10_000_000).toLocaleString()} XLM
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">
                  {isSubscriptionTrigger ? "Billing interval" : "Vesting interval"}
                </div>
                <div className="font-mono text-lg text-amber-200">
                  {streamerPreview.intervalLabel}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">Start</div>
                <div className="text-xs text-zinc-300">{streamerPreview.startDate}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">End</div>
                <div className="text-xs text-zinc-300">{streamerPreview.endDate}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-amber-300">
              {isSubscriptionTrigger ? (
                <>
                  This subscription will pull{" "}
                  <strong>
                    {(Number(streamerPreview.totalStroops) / 10_000_000).toLocaleString()} XLM
                  </strong>{" "}
                  from the subscriber over its lifetime. The subscriber must maintain sufficient
                  token allowance for each charge to succeed.
                </>
              ) : (
                <>
                  This contract will vest{" "}
                  <strong>
                    {(Number(streamerPreview.totalStroops) / 10_000_000).toLocaleString()} XLM
                  </strong>{" "}
                  over its lifetime. You must top up the contract with sufficient funds for claims
                  to succeed.
                </>
              )}
            </p>
          </section>
        )}

        {validation && !validation.ok && (
          <div className="glass-panel mt-md border-error/40 p-md rounded-xl">
            <div className="text-label-sm text-error flex items-center gap-2 font-mono">
              <span className="material-symbols-outlined text-[14px]">error</span>
              CANNOT DEPLOY · VALIDATION ERRORS
            </div>
            <ul className="text-body-md text-on-surface mt-3 space-y-1.5">
              {validation.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-error mt-1">·</span>
                  <span>
                    <code className="text-label-sm text-on-surface-variant font-mono">
                      {e.path}
                    </code>{" "}
                    — {e.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {validation?.ok && <DeployReview flowId={flow.id} network={env().STELLAR_NETWORK} />}
      </main>
    </>
  );
}
