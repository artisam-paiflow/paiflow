/**
 * Verify the deployment `POST /api/v1/demo-token` hands tokens out for.
 *
 * The route collapses every "unusable" case into one generic refusal so an
 * anonymous prober learns nothing about the demo deployment's state. That is
 * right for a caller and useless for an operator, so this runs the same checks
 * and says which one failed. Read-only — safe against any environment.
 *
 * Usage:
 *   pnpm demo:check
 *   DATABASE_URL="…staging…" pnpm demo:check
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Check = { label: string; ok: boolean; detail?: string };

function line({ label, ok, detail }: Check): string {
  return `${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`;
}

(async () => {
  const enabled = (process.env.DEMO_API_ENABLED ?? "").toLowerCase() === "true";
  const deploymentId = process.env.DEMO_API_DEPLOYMENT_ID ?? "";
  const network = process.env.STELLAR_NETWORK ?? "testnet";

  const checks: Check[] = [];
  checks.push({
    label: "DEMO_API_ENABLED is true",
    ok: enabled,
    detail: enabled ? undefined : "the endpoint answers 403 until this is set",
  });
  checks.push({
    label: "DEMO_API_DEPLOYMENT_ID is set",
    ok: deploymentId.length > 0,
  });
  checks.push({
    label: "STELLAR_NETWORK is not mainnet",
    ok: network !== "mainnet",
    detail: network === "mainnet" ? "env() refuses to boot in this combination" : network,
  });

  if (deploymentId) {
    const deployment = await db.deployment.findUnique({
      where: { id: deploymentId },
      select: {
        status: true,
        network: true,
        pipelineSnapshot: true,
        owner: { select: { username: true, isActive: true, role: true } },
      },
    });

    checks.push({ label: "deployment row exists", ok: deployment !== null });

    if (deployment) {
      checks.push({
        label: "deployment is CONFIRMED",
        ok: deployment.status === "CONFIRMED",
        detail: deployment.status,
      });
      checks.push({
        label: "deployment network matches STELLAR_NETWORK",
        ok: deployment.network === network,
        detail: `deployment=${deployment.network} instance=${network}`,
      });
      checks.push({
        label: "owner is active",
        ok: deployment.owner?.isActive === true,
        detail: deployment.owner?.username,
      });
      checks.push({
        label: "owner is not a sandbox identity",
        ok: deployment.owner?.role !== "SANDBOX",
        detail: deployment.owner?.role,
      });

      // The same shape `resolveSwapperPipeline` requires: a deposit trigger at
      // the head with an address, and a swapper somewhere downstream.
      const nodes = Array.isArray(deployment.pipelineSnapshot)
        ? (deployment.pipelineSnapshot as Array<{
            templateKind?: string;
            contractAddress?: string;
          }>)
        : [];
      const head = nodes[0];
      checks.push({
        label: "pipeline head is a deposit trigger with an address",
        ok: head?.templateKind === "DEPOSIT_TRIGGER" && Boolean(head?.contractAddress),
        detail: head?.templateKind ?? "no pipelineSnapshot",
      });
      checks.push({
        label: "pipeline contains a swapper",
        ok: nodes.some((n) => n.templateKind === "SWAPPER"),
        detail: nodes.map((n) => n.templateKind).join(" → ") || "empty",
      });

      const live = await db.deploymentApiToken.count({
        where: {
          deploymentId,
          label: "public demo",
          createdById: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      console.log(`\nLive demo tokens right now: ${live}`);
    }
  }

  console.log(`\nDemo deployment ${deploymentId || "(unset)"}\n`);
  for (const c of checks) console.log(line(c));

  const failed = checks.filter((c) => !c.ok);
  console.log(
    failed.length === 0
      ? "\nAll checks passed. POST /api/v1/demo-token will issue tokens.\n"
      : `\n${failed.length} check(s) failed. The endpoint will answer with its generic refusal.\n`,
  );
  await db.$disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
