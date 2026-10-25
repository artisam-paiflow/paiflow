import Link from "next/link";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { dashboardFlows, DashboardFlowQuerySchema } from "@/lib/dashboard/flows";
import { isStellarNetwork, stellarExpertContractUrl } from "@/lib/stellar/explorer";
import Topbar from "@/components/app/topbar";
import DeleteFlowButton from "@/components/flows/delete-flow-button";
import RetirementPanel from "@/components/deploy/retirement-panel";
import NewFlowButton from "@/components/flows/new-flow-button";

export const dynamic = "force-dynamic";

const statusBadge: Record<string, { label: string; cls: string; dot?: string }> = {
  RETIRING: { label: "RETIRING", cls: "border-tertiary/30 text-tertiary" },
  DRAFT: {
    label: "DRAFT",
    cls: "bg-surface-container-high/40 border-outline-variant/40 text-on-surface-variant",
  },
  BUILDING: {
    label: "BUILDING",
    cls: "bg-tertiary/10 border-tertiary/30 text-tertiary",
    dot: "status-dot-warn",
  },
  PENDING_SIGNATURE: {
    label: "AWAITING SIG",
    cls: "bg-tertiary/10 border-tertiary/30 text-tertiary",
    dot: "status-dot-warn",
  },
  SUBMITTED: {
    label: "DEPLOYING",
    cls: "bg-secondary/10 border-secondary/30 text-secondary",
    dot: "status-dot-deploy",
  },
  CONFIRMED: {
    label: "ACTIVE",
    cls: "bg-primary/10 border-primary/30 text-primary",
    dot: "status-dot-live",
  },
  FAILED: {
    label: "FAILED",
    cls: "bg-error-container/30 border-error/40 text-error",
  },
};

function truncateAddr(addr: string | null) {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageSession();
  const query = DashboardFlowQuerySchema.parse(await searchParams);
  const retiredView = query.view === "retired";
  const flowViewUrl = retiredView ? "/dashboard?view=retired" : "/dashboard";
  const [flowPage, deployments] = await Promise.all([
    dashboardFlows(user.id, query),
    db.deployment.findMany({
      where: { ownerId: user.id, serviceState: { not: "RETIRED" } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { flow: { select: { name: true } } },
    }),
  ]);

  const flows = flowPage.items;
  const activeCount = deployments.filter(
    (d) => d.status === "CONFIRMED" && d.serviceState === "ACTIVE",
  ).length;

  return (
    <div className="min-h-screen">
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-7xl">
        {/* Header row */}
        <div className="gap-md flex flex-wrap items-end justify-between">
          <div>
            <p className="text-label-sm text-on-surface-variant font-mono">
              / DASHBOARD · {user.username.toUpperCase()}
            </p>
            <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
              Your flows.
            </h1>
          </div>
          <NewFlowButton className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95">
            <span className="material-symbols-outlined text-[18px]">add</span>
            NEW FLOW
          </NewFlowButton>
        </div>

        {/* Metrics bento */}
        <section className="mt-md gap-md grid grid-cols-1 md:grid-cols-3">
          <MetricCard
            eyebrow="PIPELINES"
            value={String(flows.length)}
            sub={retiredView ? "retired flows shown" : "current flows shown"}
            icon="account_tree"
            accent="primary"
          />
          <MetricCard
            eyebrow="DEPLOYMENTS"
            value={String(deployments.length)}
            sub={`${activeCount} active of ${deployments.length} shown`}
            icon="rocket_launch"
            accent="secondary"
          />
          <MetricCard
            eyebrow="NETWORK"
            value={env().STELLAR_NETWORK.toUpperCase()}
            sub="stellar"
            icon="hub"
            accent="tertiary"
            live
          />
        </section>

        {/* Flows grid */}
        <section className="mt-lg">
          <div className="mb-md flex items-end justify-between">
            <h2 className="text-headline-sm text-on-surface">
              {retiredView ? "Retired flows" : "Automations"}
            </h2>
            <span className="text-label-sm text-on-surface-variant font-mono">
              {flows.length} SHOWN
            </span>
          </div>

          <nav aria-label="Flow views" className="mb-sm flex flex-wrap gap-4">
            <Link
              href="/dashboard"
              aria-current={!retiredView ? "page" : undefined}
              className="text-label-md text-primary underline underline-offset-4"
            >
              Current flows
            </Link>
            <Link
              href="/dashboard?view=retired"
              aria-current={retiredView ? "page" : undefined}
              className="text-label-md text-primary underline underline-offset-4"
            >
              Retired flows
            </Link>
          </nav>
          <p className="text-body-sm text-on-surface-variant mb-md">
            {retiredView
              ? "These flow definitions are retained because all their deployments have retired. Retired deployments remain inaccessible and their service cannot be restored."
              : "Drafts and flows with active or retiring deployments. Flows whose deployments have all retired are in Retired flows."}
          </p>

          {flows.length === 0 ? (
            <div className="glass-panel p-xl flex flex-col items-center justify-center rounded-xl border-dashed text-center">
              <span className="material-symbols-outlined text-on-surface-variant/50 text-[40px]">
                account_tree
              </span>
              <p className="mt-md text-body-md text-on-surface-variant">
                {query.cursor
                  ? "No flows on this page. Return to the newest flows."
                  : retiredView
                    ? "No fully retired flows."
                    : "No current flows. Create a flow or view your retired flows."}
              </p>
              {!retiredView && !query.cursor ? (
                <p className="text-label-sm text-on-surface-variant/70 mt-1 font-mono">
                  CLICK NEW FLOW TO START BUILDING.
                </p>
              ) : null}
              <NewFlowButton className="mt-md bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-5 py-2.5 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95">
                <span className="material-symbols-outlined text-[16px]">add</span>
                NEW FLOW
              </NewFlowButton>
            </div>
          ) : (
            <div className="gap-md grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {flows.map((f) => (
                <div key={f.id} className="glass-panel relative rounded-xl">
                  <Link
                    href={`/flows/${f.id}`}
                    className="glass-panel group gap-sm p-md hover:border-primary/50 flex flex-col rounded-xl transition-all duration-200 hover:shadow-[0_0_24px_-8px_rgba(255,177,196,0.5)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-label-sm text-primary inline-flex items-center gap-2 pr-10 font-mono">
                        <span className="bg-primary h-1.5 w-1.5 rounded-full" />
                        {f.templateKind?.toUpperCase() ?? "FLOW"}
                      </span>
                    </div>
                    <h3 className="text-headline-sm text-on-surface truncate">{f.name}</h3>
                    <div className="text-label-sm text-on-surface-variant mt-auto flex items-center gap-2 font-mono">
                      <span className="material-symbols-outlined text-[14px]">schedule</span>
                      {new Date(f.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </Link>
                  <DeleteFlowButton
                    flowId={f.id}
                    flowName={f.name}
                    hasDeployments={f._count.deployments > 0}
                  />
                </div>
              ))}
            </div>
          )}
          <nav aria-label="Flow pages" className="mt-md flex flex-wrap gap-4">
            {query.cursor ? (
              <Link href={flowViewUrl} className="text-primary underline underline-offset-4">
                Newest flows
              </Link>
            ) : null}
            {flowPage.nextCursor ? (
              <Link
                href={`${flowViewUrl}${retiredView ? "&" : "?"}cursor=${flowPage.nextCursor}`}
                className="text-primary underline underline-offset-4"
              >
                Older flows
              </Link>
            ) : null}
          </nav>
        </section>

        {/* Deployments table */}
        <section className="mt-xl">
          <div className="mb-md flex items-end justify-between">
            <h2 className="text-headline-sm text-on-surface">Recent deployments</h2>
            <span className="text-label-sm text-on-surface-variant font-mono">
              {deployments.length} SHOWN
            </span>
          </div>

          <div className="glass-panel overflow-hidden rounded-xl">
            {deployments.length === 0 ? (
              <div className="p-md text-label-md text-on-surface-variant font-mono">
                NO ACTIVE OR RETIRING DEPLOYMENTS.
              </div>
            ) : (
              <table className="w-full table-fixed">
                <thead>
                  <tr className="bg-surface-container/60 text-label-sm text-on-surface-variant font-mono">
                    <th className="px-md w-[28%] py-2.5 text-left">FLOW</th>
                    <th className="px-md w-[16%] py-2.5 text-left">STATUS</th>
                    <th className="px-md w-[16%] py-2.5 text-left">NETWORK</th>
                    <th className="px-md w-[12%] py-2.5 text-left">CONTRACT</th>
                    <th className="px-md w-[16%] py-2.5 text-right">CREATED</th>
                    <th className="px-md w-[12%] py-2.5 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-outline-variant/10 divide-y">
                  {deployments.map((d) => {
                    const badge = statusBadge[
                      d.serviceState === "RETIRING" ? "RETIRING" : d.status
                    ] ?? {
                      label: d.status?.toUpperCase() ?? "—",
                      cls: "bg-surface-container-high/40 border-outline-variant/30 text-on-surface-variant",
                    };
                    const explorerUrl =
                      d.contractAddress && isStellarNetwork(d.network)
                        ? stellarExpertContractUrl(d.contractAddress, d.network)
                        : null;
                    return (
                      <tr
                        key={d.id}
                        className="group hover:bg-surface-container-high/40 transition-colors"
                      >
                        <td className="px-md py-0">
                          <Link
                            href={`/deployments/${d.id}`}
                            className="text-body-md text-on-surface group-hover:text-primary block truncate py-3"
                          >
                            {d.flow.name}
                          </Link>
                        </td>
                        <td className="px-md py-0">
                          <Link
                            href={`/deployments/${d.id}`}
                            className="block py-3"
                            aria-hidden="true"
                            tabIndex={-1}
                          >
                            <span
                              className={`text-label-sm inline-flex w-fit items-center gap-1.5 rounded border px-2 py-1 font-mono ${badge.cls}`}
                            >
                              {badge.dot ? <span className={`${badge.dot} h-1.5 w-1.5`} /> : null}
                              {badge.label}
                            </span>
                          </Link>
                        </td>
                        <td className="px-md py-0">
                          <Link
                            href={`/deployments/${d.id}`}
                            className="text-label-sm text-on-surface-variant block py-3 font-mono"
                            aria-hidden="true"
                            tabIndex={-1}
                          >
                            {d.network?.toUpperCase()}
                          </Link>
                        </td>
                        <td className="px-md py-0">
                          <Link
                            href={`/deployments/${d.id}`}
                            className="text-label-sm text-on-surface block truncate py-3 font-mono"
                            aria-hidden="true"
                            tabIndex={-1}
                          >
                            {truncateAddr(d.contractAddress)}
                          </Link>
                        </td>
                        <td className="px-md py-0 text-right">
                          <Link
                            href={`/deployments/${d.id}`}
                            className="text-label-sm text-on-surface-variant block py-3 font-mono"
                            aria-hidden="true"
                            tabIndex={-1}
                          >
                            {new Date(d.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </Link>
                        </td>
                        <td className="px-md py-0">
                          <div className="flex items-center gap-2">
                            {explorerUrl ? (
                              <a
                                href={explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open on stellar.expert"
                                title="Open on stellar.expert"
                                className="text-on-surface-variant hover:text-primary inline-flex h-8 w-8 items-center justify-center transition-colors"
                              >
                                <span className="material-symbols-outlined text-[16px]">
                                  open_in_new
                                </span>
                              </a>
                            ) : (
                              <span className="inline-block h-8 w-8" aria-hidden />
                            )}
                            <RetirementPanel
                              displayMode="icon"
                              deploymentId={d.id}
                              flowName={d.flow.name}
                              initial={{ serviceState: d.serviceState, retirementBlocker: null }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {/* Mobile FAB */}
      <NewFlowButton
        ariaLabel="New flow"
        className="bg-primary text-on-primary fixed right-6 bottom-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6),0_0_20px_rgba(255,177,196,0.4)] transition-all hover:-translate-y-px hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6),0_0_28px_rgba(255,177,196,0.7)] md:hidden"
      >
        <span className="material-symbols-outlined">add</span>
      </NewFlowButton>
    </div>
  );
}

function MetricCard({
  eyebrow,
  value,
  sub,
  icon,
  accent,
  live,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  icon: string;
  accent: "primary" | "secondary" | "tertiary";
  live?: boolean;
}) {
  const tone =
    accent === "primary"
      ? "text-primary"
      : accent === "secondary"
        ? "text-secondary"
        : "text-tertiary";
  const dot =
    accent === "primary"
      ? "status-dot-live"
      : accent === "secondary"
        ? "status-dot-deploy"
        : "status-dot-warn";
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="flex items-center justify-between">
        <span className={`text-label-sm font-mono ${tone}`}>{eyebrow}</span>
        <span className={`material-symbols-outlined text-[18px] ${tone} opacity-80`}>{icon}</span>
      </div>
      <div className="font-display text-on-surface mt-3 text-[40px] leading-none font-bold tracking-[-0.02em]">
        {value}
      </div>
      <div className="text-label-sm text-on-surface-variant mt-3 flex items-center gap-2 font-mono">
        {live ? <span className={`${dot} h-1.5 w-1.5`} /> : null}
        {sub.toUpperCase()}
      </div>
    </div>
  );
}
