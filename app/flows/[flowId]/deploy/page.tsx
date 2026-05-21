import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { flowToParams } from "@/lib/flows/to-params";
import DeployReview from "@/components/deploy/deploy-review";
import { env } from "@/lib/env";
import { TemplateKind } from "@prisma/client";

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

  let streamerPreview: {
    totalStroops: string;
    durationSecs: number;
    intervalLabel: string;
    startDate: string;
    endDate: string;
  } | null = null;
  if (graph.success && validation?.ok && validation.templateKind === TemplateKind.STREAMER) {
    const params = flowToParams(graph.data, validation.templateKind);
    if (params.kind === "streamer") {
      const durationSecs = params.endTs - params.startTs;
      const triggerNode = graph.data.nodes.find((n) => n.type === "on_schedule") as
        | {
            type: "on_schedule";
            config: { interval: string };
          }
        | undefined;
      const intervalSeconds =
        triggerNode?.config.interval === "minute"
          ? 60
          : triggerNode?.config.interval === "hour"
            ? 3600
            : 86400;
      const intervalLabel =
        intervalSeconds === 60
          ? "every minute"
          : intervalSeconds === 3600
            ? "every hour"
            : "every day";
      const totalStroops = (BigInt(params.ratePerSecondStroops) * BigInt(durationSecs)).toString();
      streamerPreview = {
        totalStroops,
        durationSecs,
        intervalLabel,
        startDate: new Date(params.startTs * 1000).toISOString(),
        endDate: new Date(params.endTs * 1000).toISOString(),
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
          <div className="mt-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
            TEMPLATE: <span className="text-on-surface">{flow.templateKind}</span>
          </div>
        </section>

        {streamerPreview && (
          <section className="mt-4 rounded-xl border border-amber-900 bg-amber-950/20 p-4">
            <div className="text-[10px] font-medium tracking-wide text-amber-400 uppercase">
              Streamer funding required
            </div>
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-zinc-400">Total vest amount</div>
                <div className="font-mono text-lg text-amber-200">
                  {(Number(streamerPreview.totalStroops) / 10_000_000).toLocaleString()} XLM
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">Vesting interval</div>
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
              This contract will vest{" "}
              <strong>
                {(Number(streamerPreview.totalStroops) / 10_000_000).toLocaleString()} XLM
              </strong>{" "}
              over its lifetime. You must top up the contract with sufficient funds for claims to
              succeed.
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
