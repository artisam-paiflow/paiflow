#!/usr/bin/env tsx
/**
 * Snapshots the Instawards success metrics for the official alpha-tester cohort
 * alone, from PostHog, with the same definitions every time.
 *
 * WHY POSTHOG AND NOT THE DATABASE: scripts/instawards-metrics.ts counts rows in
 * the application database and filters on nothing but status and createdAt, so
 * every figure it reports includes the disposable sandbox visitors and the
 * project's own `admin` / `judge` accounts. The alpha column has to be five
 * named people, and the live beta database has no public endpoint (the TCP
 * proxies were removed in a80b369), so PostHog — which identifies per person —
 * is the only source that can be queried reproducibly.
 *
 * WHO COUNTS: the five `distinct_id`s in the cohort file, and nobody else. The
 * PostHog cohort named "Alpha testers" is defined as `role = USER`, which since
 * the 16 September cutover also matches paiflow.xyz visitors
 * (docs/analytics/alpha-tracking-plan.md:47-50). It is deliberately not used.
 *
 * Identity is `distinct_id = User.id` (docs/analytics/alpha-tracking-plan.md:51).
 * Every event counted here — deploy_confirmed, trigger_confirmed,
 * transaction_signed — happens after sign-in, so the tester's distinct_id is
 * their User.id by then. Pre-login anonymous activity is out of scope by design.
 *
 *   POSTHOG_PERSONAL_API_KEY=phx_… pnpm instawards:alpha-metrics \
 *     > docs/instawards/evidence/alpha-metrics-$(date +%F).json
 *
 * Options:
 *   --cohort=path        cohort file (default docs/instawards/evidence/alpha-testers.json)
 *   --since=2026-09-16   start of the counting window (default: the file's windowStart)
 *   --source="…"         how the snapshot names its provenance
 *   --per-tester         also emit the pseudonymous per-tester breakdown
 */
import { config as dotenvConfig } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

dotenvConfig({ path: resolve(".env.local") });
dotenvConfig({ path: resolve(".env") });

const COHORT_FILE = "docs/instawards/evidence/alpha-testers.json";
/** Provenance for the snapshot, which is committed as evidence. It has to name
 *  how many ids were actually queried: a fixed "five" would have the file claim
 *  a population it did not read the moment the cohort is part-issued. */
function defaultSource(issued: number, path: string): string {
  return `PostHog HogQL over the ${issued} issued alpha-tester distinct_id(s) in ${path}.`;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

type Tester = { label: string; userId: string | null; wallets: string[] };
type Cohort = {
  cohort: string;
  windowStart: string;
  /** What the round targets. `testers.length` is what has actually been issued. */
  plannedCohortSize?: number;
  testers: Tester[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cohort is the whole point of this script, so a half-filled file is a hard
 *  stop rather than a snapshot of zeroes. A committed evidence file that reports
 *  0 because nobody had filled in the UUIDs would be worse than no file. */
function loadCohort(path: string): Cohort {
  let parsed: Cohort;
  try {
    parsed = JSON.parse(readFileSync(resolve(path), "utf8")) as Cohort;
  } catch (err) {
    throw new Error(`Could not read the cohort file at ${path}: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed.testers) || parsed.testers.length === 0) {
    throw new Error(`${path} lists no testers.`);
  }

  const missing = parsed.testers.filter((t) => !t.userId);
  if (missing.length > 0) {
    throw new Error(
      `The alpha-tester identities are not populated yet: ${missing
        .map((t) => t.label)
        .join(", ")} still ${missing.length === 1 ? "has" : "have"} a null userId in ${path}.\n` +
        `Fill in each tester's User.id UUID (it is also their PostHog distinct_id) and run again. ` +
        `This script will not emit a snapshot of zeroes.`,
    );
  }

  const malformed = parsed.testers.filter((t) => !UUID.test(t.userId ?? ""));
  if (malformed.length > 0) {
    throw new Error(
      `Not a User.id UUID: ${malformed.map((t) => `${t.label}=${t.userId}`).join(", ")}`,
    );
  }

  const ids = parsed.testers.map((t) => t.userId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Two testers in ${path} share a userId.`);
  }

  // Issued vs planned. Mid-round these differ legitimately, so this is not an
  // error — but a dropped or duplicated entry would otherwise silently snapshot
  // the wrong population. stderr keeps it loud for a human while leaving the
  // snapshot on stdout clean for redirection.
  const planned = parsed.plannedCohortSize;
  if (planned !== undefined && planned !== parsed.testers.length) {
    console.error(
      `Note: ${path} lists ${parsed.testers.length} issued account(s) against a planned ` +
        `cohort of ${planned}. The snapshot covers the ${parsed.testers.length} listed.`,
    );
  }

  return parsed;
}

const PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "610680";
const POSTHOG_API = process.env.POSTHOG_API_HOST ?? "https://us.posthog.com";

/** Read-only HogQL. The key is a personal API key, script-only: lib/env.ts is
 *  `server-only` and cannot be imported from a tsx script, so this follows the
 *  same process.env pattern as UPLOADER_SECRET in scripts/deploy-factory.ts. */
async function hogql(query: string): Promise<unknown[][]> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) {
    throw new Error(
      "POSTHOG_PERSONAL_API_KEY is not set. Create a personal API key in PostHog with " +
        "query read access and pass it in the environment; see .env.example.",
    );
  }

  const res = await fetch(`${POSTHOG_API}/api/projects/${PROJECT_ID}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });

  if (!res.ok) {
    throw new Error(`PostHog ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const body = (await res.json()) as { results?: unknown[][] };
  return body.results ?? [];
}

/** Every query is scoped to the cohort and the window, in one place, so no
 *  metric can quietly widen its population.
 *
 *  The timezone is pinned. HogQL parses a bare datetime literal in the PostHog
 *  *project's* timezone, which is a dashboard setting outside this repo —
 *  changing it there would shift every snapshot's window with no diff to show
 *  for it. The sibling generator already means UTC by `--since`
 *  (`new Date(\`${"${since}"}T00:00:00Z\`)` in scripts/instawards-metrics.ts), and both
 *  have to mean the same thing. */
function scope(ids: string[], since: string): string {
  const list = ids.map((id) => `'${id}'`).join(", ");
  return `distinct_id in (${list}) and timestamp >= toDateTime('${since} 00:00:00', 'UTC')`;
}

async function scalar(query: string): Promise<number> {
  const rows = await hogql(query);
  return Number(rows[0]?.[0] ?? 0);
}

async function main() {
  const cohortPath = arg("cohort", COHORT_FILE);
  const cohort = loadCohort(cohortPath);
  const since = arg("since", cohort.windowStart);
  const source = arg("source", defaultSource(cohort.testers.length, cohortPath));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`Invalid --since=${since}`);

  const ids = cohort.testers.map((t) => t.userId as string);
  const where = scope(ids, since);

  const deployments = await scalar(
    `select count(distinct properties.deployment_id) from events
      where ${where} and event = 'deploy_confirmed'`,
  );

  const distinctFlows = await scalar(
    `select count(distinct properties.flow_id) from events
      where ${where} and event = 'deploy_confirmed'`,
  );

  const swapperFlows = await scalar(
    `select count(distinct properties.deployment_id) from events
      where ${where} and event = 'trigger_confirmed'
        and toString(properties.has_swap) = 'true'`,
  );

  const walletsDeploying = await scalar(
    `select count(distinct properties.signer_address) from events
      where ${where} and event = 'transaction_signed'
        and toString(properties.kind) = 'deploy'`,
  );

  const walletsSigning = await scalar(
    `select count(distinct properties.signer_address) from events
      where ${where} and event = 'transaction_signed'`,
  );

  const txSigned = await scalar(
    `select count(distinct properties.tx_hash) from events
      where ${where} and event = 'transaction_signed'`,
  );

  const testersActive = await scalar(
    `select count(distinct distinct_id) from events where ${where}`,
  );

  const snapshot = {
    snapshotAt: new Date().toISOString(),
    cohort: cohort.cohort,
    // Issued vs planned: an account exists before its session runs, and a
    // snapshot that reported only one of the two would read as a shortfall or
    // as a full round, neither of which is true mid-round.
    cohortSize: cohort.testers.length,
    plannedCohortSize: cohort.plannedCohortSize ?? cohort.testers.length,
    source:
      `${source} Window: events on or after ${since}, Stellar testnet. ` +
      `Generated by scripts/alpha-metrics.ts.`,
    caveat:
      "PostHog undercounts relative to the database: a client event lost to an ad blocker or a " +
      "closed tab is never captured. transaction_signed is captured server-side, once per hash, " +
      "so the wallet and transaction figures do not have that exposure; deploy_confirmed and " +
      "trigger_confirmed are browser events and are floors, not exact counts.",
    metrics: {
      uniqueFlowsDeployed: {
        value: deployments,
        target: "≥ 5",
        met: deployments >= 5,
        definition: `COUNT(DISTINCT deployment_id) from deploy_confirmed, cohort only, since ${since}`,
        note: `${distinctFlows} distinct flow ids behind them`,
      },
      uniqueSwapperFlowsExecutedOnTestnet: {
        value: swapperFlows,
        target: "≥ 5",
        met: swapperFlows >= 5,
        definition:
          "COUNT(DISTINCT deployment_id) from trigger_confirmed where has_swap, cohort only",
      },
      distinctWalletsDeploying: {
        value: walletsDeploying,
        target: "≥ 6",
        met: walletsDeploying >= 6,
        definition:
          "COUNT(DISTINCT signer_address) from transaction_signed where kind = 'deploy', cohort only",
        note: "Server-side event. A tester signs with more than one wallet, so this counts addresses across the cohort, not people.",
      },
      contractExecutionsEventsPublished: {
        value: null,
        target: "≥ 60",
        met: null,
        definition: "Not derivable from PostHog",
        note: "ContractEvent rows have no server-side analytics counterpart; live_event_rendered is a browser render, not a published event. Take this row from scripts/instawards-metrics.ts against the live database.",
      },
      transactionsSigned: {
        value: txSigned,
        definition: "COUNT(DISTINCT tx_hash) from transaction_signed, cohort only",
      },
      distinctWalletsSigning: {
        value: walletsSigning,
        definition: "COUNT(DISTINCT signer_address) from transaction_signed, any kind, cohort only",
      },
      testersActive: {
        value: testersActive,
        target: `= ${cohort.testers.length}`,
        met: testersActive === cohort.testers.length,
        definition: "COUNT(DISTINCT distinct_id) with any event in the window",
        note:
          `${testersActive} of ${cohort.testers.length} issued accounts have run a session; ` +
          `the round targets ${cohort.plannedCohortSize ?? cohort.testers.length}. ` +
          "Below the issued count means a tester was given an account and has not used it yet.",
      },
    },
    ...(hasFlag("--per-tester")
      ? {
          perTester: await Promise.all(
            cohort.testers.map(async (t) => {
              const one = scope([t.userId as string], since);
              return {
                label: t.label,
                deployments: await scalar(
                  `select count(distinct properties.deployment_id) from events
                    where ${one} and event = 'deploy_confirmed'`,
                ),
                walletsSigning: await scalar(
                  `select count(distinct properties.signer_address) from events
                    where ${one} and event = 'transaction_signed'`,
                ),
                transactionsSigned: await scalar(
                  `select count(distinct properties.tx_hash) from events
                    where ${one} and event = 'transaction_signed'`,
                ),
              };
            }),
          ),
        }
      : {}),
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
