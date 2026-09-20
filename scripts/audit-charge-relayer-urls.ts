/**
 * Read-only sweep of every stored tenant charge-relayer URL against the #581
 * guard. Rows saved before that check landed were never validated, so run this
 * once per environment after deploying it — and from inside the platform (the
 * Railway shell), not a laptop: a name that resolves publicly for you may
 * resolve to a private address from inside the network, which is the case that
 * matters.
 *
 * It writes nothing. A refused row is left alone deliberately — silently
 * discarding a tenant's configuration is worse than refusing to use it. The
 * cron will fail that deployment's next charge with the same message the tenant
 * sees when they re-save.
 *
 * Note it makes outbound DNS queries for tenant-supplied hostnames.
 *
 * Exits 1 if anything was refused, so it can gate a cutover.
 */
import { PrismaClient } from "@prisma/client";
import { checkPublicHttpsUrl } from "../lib/net/public-url";

const db = new PrismaClient();

(async () => {
  const rows = await db.deployment.findMany({
    where: { chargeRelayerUrl: { not: null } },
    select: {
      id: true,
      ownerId: true,
      chargeRelayerMode: true,
      chargeRelayerUrl: true,
      status: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Checking ${rows.length} deployment(s) with a stored charge-relayer URL\n`);

  let refused = 0;
  for (const row of rows) {
    const result = await checkPublicHttpsUrl(row.chargeRelayerUrl as string);
    const host = (() => {
      try {
        return new URL(row.chargeRelayerUrl as string).host;
      } catch {
        return "<unparseable>";
      }
    })();

    if (result.ok) {
      console.log(`OK       ${row.id}  ${row.chargeRelayerMode}/${row.status}  ${host}`);
    } else {
      refused++;
      console.log(
        `REFUSED  ${row.id}  ${row.chargeRelayerMode}/${row.status}  ${host}  ` +
          `owner=${row.ownerId}  reason=${result.reason}  (${result.detail})`,
      );
    }
  }

  console.log(`\n${rows.length - refused} ok, ${refused} refused`);
  await db.$disconnect();
  if (refused > 0) process.exitCode = 1;
})();
