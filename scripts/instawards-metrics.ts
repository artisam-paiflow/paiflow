#!/usr/bin/env tsx
/**
 * Snapshots the Instawards success metrics (SOW §6.3 and §3.8) from the
 * application's own database, read-only, with the same definitions every time.
 *
 * Point DATABASE_URL at the public app's database and redirect the JSON into
 * docs/instawards/evidence/metrics-<date>.json:
 *
 *   railway run -p <project> -s Postgres -e staging -- \
 *     bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm -s tsx scripts/instawards-metrics.ts' \
 *     > docs/instawards/evidence/metrics-$(date +%F).json
 *
 * Options:
 *   --since=2026-09-07   start of the counting window (default: sprint start)
 *   --wasm-count=1       contract WASM binaries uploaded to testnet for the sprint
 *   --flows              emit the executed swapper-flow list instead of the metrics
 *                        (the evidence file d1/14-swapper-flows.json)
 */
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Neither call overrides, so dotenv's first-write-wins gives shell > .env.local
// > .env. That ordering is the point of this script: `railway run` exports the
// public app's DATABASE_URL, and .env.local would otherwise replace it with the
// local development database and report figures for the wrong system.
dotenvConfig({ path: resolve(".env.local") });
dotenvConfig({ path: resolve(".env") });

const SPRINT_START = "2026-09-07";

/** Owners reported by name in the evidence file. These are the project's own
 *  operational accounts, and naming them tells a reviewer which runs were the
 *  builder's and which were the QA pass. Every other owner is reported as
 *  "user": the flow list is committed and published on the public mirror. */
const NAMED_OWNERS = ["admin", "judge"];

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

const db = new PrismaClient();

type FlowRow = {
  deploymentId: string;
  confirmedAt: Date | null;
  owner: string;
  signer: string | null;
  deployTxHash: string | null;
  swapper: string | null;
  txHash: string;
  ledger: number;
  occurredAt: Date;
  amountIn: string | null;
  amountOut: string | null;
};

/** The executed swapper flows, newest swap last, in the shape of the evidence
 *  file. Amounts stay strings: a stroop is beyond a float's precision.
 *
 *  The swap event's topics carry the asset-in and asset-out contracts, not the
 *  swapper, so the swapper address is resolved from the deployment's
 *  pipelineSnapshot — the durable nodeId -> contractAddress map.
 *
 *  Sandbox owners are reported as "sandbox": the per-visitor usernames are
 *  disposable identifiers and naming them adds nothing a reviewer can check. */
async function collectSwapperFlows(windowStart: Date) {
  const rows = await db.$queryRaw<FlowRow[]>`
    SELECT d."id"::text        AS "deploymentId",
           d."confirmedAt"     AS "confirmedAt",
           CASE
             WHEN u."role" = 'SANDBOX' THEN 'sandbox'
             WHEN u."username" = ANY (${NAMED_OWNERS}) THEN u."username"
             ELSE 'user'
           END AS "owner",
           d."sourceAccount"   AS "signer",
           d."deployTxHash"    AS "deployTxHash",
           (SELECT n ->> 'contractAddress' FROM jsonb_array_elements(d."pipelineSnapshot"::jsonb) AS n
             WHERE n ->> 'templateKind' = 'SWAPPER' LIMIT 1) AS "swapper",
           e."txHash"          AS "txHash",
           e."ledger"          AS "ledger",
           e."occurredAt"      AS "occurredAt",
           e."payload" -> 'value' ->> 0 AS "amountIn",
           e."payload" -> 'value' ->> 1 AS "amountOut"
    FROM "ContractEvent" e
    JOIN "Deployment" d ON d."id" = e."deploymentId"
    JOIN "User" u ON u."id" = d."ownerId"
    WHERE d."createdAt" >= ${windowStart} AND e."payload" -> 'topics' ->> 0 = 'swap'
    ORDER BY d."confirmedAt" ASC, e."ledger" ASC`;

  const byDeployment = new Map<string, ReturnType<typeof shell>>();

  function shell(r: FlowRow) {
    return {
      n: 0,
      deploymentId: r.deploymentId,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      owner: r.owner,
      signer: r.signer,
      deployTxHash: r.deployTxHash,
      swapper: r.swapper,
      swaps: [] as {
        txHash: string;
        ledger: number;
        occurredAt: string;
        amountInStroops: string | null;
        amountOutStroops: string | null;
      }[],
    };
  }

  for (const r of rows) {
    const existing = byDeployment.get(r.deploymentId) ?? shell(r);
    existing.swaps.push({
      txHash: r.txHash,
      ledger: r.ledger,
      occurredAt: r.occurredAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      amountInStroops: r.amountIn,
      amountOutStroops: r.amountOut,
    });
    byDeployment.set(r.deploymentId, existing);
  }

  return [...byDeployment.values()].map((f, i) => ({ ...f, n: i + 1 }));
}

async function count(rows: Promise<{ n: bigint }[]>): Promise<number> {
  return Number((await rows)[0]?.n ?? 0n);
}

async function main() {
  const since = arg("since", SPRINT_START);
  const wasmUploaded = Number(arg("wasm-count", "1"));
  if (!Number.isSafeInteger(wasmUploaded) || wasmUploaded < 0) {
    throw new Error(`Invalid --wasm-count: expected a non-negative integer`);
  }
  const windowStart = new Date(`${since}T00:00:00Z`);

  if (Number.isNaN(windowStart.getTime())) throw new Error(`Invalid --since=${since}`);

  if (hasFlag("--flows")) {
    console.log(JSON.stringify(await collectSwapperFlows(windowStart), null, 2));
    return;
  }

  const deployments = await count(db.$queryRaw`
    SELECT COUNT(*)::bigint AS n FROM "Deployment"
    WHERE "status" = 'CONFIRMED' AND "createdAt" >= ${windowStart}`);

  const distinctFlows = await count(db.$queryRaw`
    SELECT COUNT(DISTINCT "flowId")::bigint AS n FROM "Deployment"
    WHERE "status" = 'CONFIRMED' AND "createdAt" >= ${windowStart}`);

  const events = await count(db.$queryRaw`
    SELECT COUNT(*)::bigint AS n FROM "ContractEvent" e
    JOIN "Deployment" d ON d."id" = e."deploymentId"
    WHERE d."createdAt" >= ${windowStart}`);

  // A swap is a PAYOUT row the swapper emitted; the contract's first event
  // topic is the literal "swap". There is no SWAP member of EventKind.
  const swapperFlows = await count(db.$queryRaw`
    SELECT COUNT(DISTINCT e."deploymentId")::bigint AS n FROM "ContractEvent" e
    JOIN "Deployment" d ON d."id" = e."deploymentId"
    WHERE d."createdAt" >= ${windowStart} AND e."payload" -> 'topics' ->> 0 = 'swap'`);

  const swapTransactions = await count(db.$queryRaw`
    SELECT COUNT(DISTINCT e."txHash")::bigint AS n FROM "ContractEvent" e
    JOIN "Deployment" d ON d."id" = e."deploymentId"
    WHERE d."createdAt" >= ${windowStart} AND e."payload" -> 'topics' ->> 0 = 'swap'`);

  const walletsDeploying = await count(db.$queryRaw`
    SELECT COUNT(DISTINCT "sourceAccount")::bigint AS n FROM "Deployment"
    WHERE "status" = 'CONFIRMED' AND "createdAt" >= ${windowStart} AND "sourceAccount" IS NOT NULL`);

  const walletsConnected = await count(db.$queryRaw`
    SELECT COUNT(DISTINCT "metadata" ->> 'address')::bigint AS n FROM "AuditLog"
    WHERE "action" = 'WALLET_CONNECT' AND "createdAt" >= ${windowStart}`);

  const sandboxSessions = await count(db.$queryRaw`
    SELECT COUNT(*)::bigint AS n FROM "User" WHERE "role" = 'SANDBOX'`);

  const usersTotal = await count(db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "User"`);
  const deploymentsAllTime = await count(db.$queryRaw`
    SELECT COUNT(*)::bigint AS n FROM "Deployment" WHERE "status" = 'CONFIRMED'`);
  const eventsAllTime = await count(db.$queryRaw`
    SELECT COUNT(*)::bigint AS n FROM "ContractEvent"`);

  const snapshot = {
    snapshotAt: new Date().toISOString(),
    source: `Read-only SQL against the paiflow.xyz application database (Railway project paiflow, environment staging). Window: rows created on or after ${windowStart.toISOString()}, Stellar testnet. Generated by scripts/instawards-metrics.ts.`,
    metrics: {
      uniqueFlowsDeployed: {
        value: deployments,
        target: "≥ 5",
        met: deployments >= 5,
        definition: `COUNT(*) FROM Deployment WHERE status = 'CONFIRMED' AND createdAt >= ${since}`,
        note: `${distinctFlows} distinct Flow ids; a flow deployed twice counts twice, matching 'deployments' in the SOW wording`,
      },
      contractExecutionsEventsPublished: {
        value: events,
        target: "≥ 60",
        met: events >= 60,
        definition: "COUNT(*) FROM ContractEvent joined to deployments created in the window",
        note: "Rows the app decoded and published to the live feed. On-chain each swap transaction emits 12 contract events, so the raw on-chain count is higher; the app-recorded figure is the one reported.",
      },
      uniqueSwapperFlowsExecutedOnTestnet: {
        value: swapperFlows,
        target: "≥ 5",
        met: swapperFlows >= 5,
        definition:
          "COUNT(DISTINCT deploymentId) FROM ContractEvent WHERE payload.topics[0] = 'swap'",
        note: `Each is a confirmed deployment whose swapper emitted a swap event through the Soroswap router, across ${swapTransactions} swap transactions; listed in d1/14-swapper-flows.json`,
      },
      distinctWalletsDeploying: {
        value: walletsDeploying,
        target: "≥ 6",
        met: walletsDeploying >= 6,
        definition: `COUNT(DISTINCT sourceAccount) FROM Deployment WHERE status = 'CONFIRMED' AND createdAt >= ${since}`,
        note: "SOW §3.8, not §6.3",
      },
      contractWasmUploaded: {
        value: wasmUploaded,
        target: "≥ 1",
        met: wasmUploaded >= 1,
        definition:
          "Swapper WASM e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a on testnet; ContractTemplate SWAPPER/TESTNET row points at it and every public-app swap flow instantiates it",
      },
      publicTestnetUrlLive: {
        value: "https://paiflow.xyz",
        target: "Yes",
        met: true,
        definition: "Public app on Stellar testnet, reachable with no account via the sandbox",
      },
      demoVideoPublished: {
        value: false,
        target: "Yes",
        met: false,
        definition: "SOW §5.1 week 4 deliverable; the D1 screen recording is not the demo video",
      },
      distinctWalletsConnected: {
        value: walletsConnected,
        definition: `COUNT(DISTINCT metadata.address) FROM AuditLog WHERE action = 'WALLET_CONNECT' AND createdAt >= ${since}`,
      },
      sandboxSessions: {
        value: sandboxSessions,
        definition: "COUNT(*) FROM User WHERE role = 'SANDBOX'",
      },
      usersTotal: { value: usersTotal },
      deploymentsAllTime: {
        value: deploymentsAllTime,
        definition: "COUNT(*) FROM Deployment WHERE status = 'CONFIRMED', no window",
      },
      contractEventsAllTime: {
        value: eventsAllTime,
        definition: "COUNT(*) FROM ContractEvent, no window",
      },
    },
  };

  console.log(JSON.stringify(snapshot, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
