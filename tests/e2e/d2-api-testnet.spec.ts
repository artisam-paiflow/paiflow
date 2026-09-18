/**
 * Instawards D2 (#471): execute a deployed `on_receive XLM → swap → pay USDC`
 * flow through `/api/v1` on the public app, exactly as the developer guide's
 * curl sequence does — prepare, sign locally, submit, poll events — and prove
 * the swap went through the Soroswap router. The only credential is the
 * deployment token: requests carry no session cookie.
 *
 * The deployment and its token come from the owner's API access panel; this
 * spec deploys nothing. Writes evidence JSON into docs/instawards/evidence/d2/
 * with the token never written. Manual; never in CI.
 *
 * Global setup still signs in (every spec shares it), so pass an account that
 * exists on the target app.
 *
 *   PLAYWRIGHT_NO_SERVER=1 PLAYWRIGHT_BASE_URL=https://paiflow.xyz \
 *   ADMIN_SEED_USERNAME=… ADMIN_SEED_PASSWORD=… \
 *   D2_DEPLOYMENT_ID=… D2_API_TOKEN=pfk_… D2_DEPOSITOR_SECRET=S… \
 *   STELLAR_SOROSWAP_ROUTER_TESTNET=C… pnpm exec playwright test \
 *     tests/e2e/d2-api-testnet.spec.ts --project=chromium-desktop
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Keypair, TransactionBuilder, xdr, StrKey } from "@stellar/stellar-sdk";
import { writeFile } from "node:fs/promises";

const OUT = "docs/instawards/evidence/d2";
const RPC = "https://soroban-testnet.stellar.org";
const ROUTER = process.env.STELLAR_SOROSWAP_ROUTER_TESTNET ?? "";
const DEPLOYMENT_ID = process.env.D2_DEPLOYMENT_ID ?? "";
const TOKEN = process.env.D2_API_TOKEN ?? "";
const DEPOSITOR_SECRET = process.env.D2_DEPOSITOR_SECRET ?? "";
const AMOUNT = process.env.D2_AMOUNT_STROOPS ?? "100000000";

test.skip(
  !DEPLOYMENT_ID || !TOKEN || !DEPOSITOR_SECRET || !ROUTER,
  "needs D2_DEPLOYMENT_ID, D2_API_TOKEN, D2_DEPOSITOR_SECRET, STELLAR_SOROSWAP_ROUTER_TESTNET",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);
// Token-only: drop the admin session global setup stored, so nothing but the bearer authenticates.
test.use({ storageState: { cookies: [], origins: [] } });

const depositor = DEPOSITOR_SECRET ? Keypair.fromSecret(DEPOSITOR_SECRET) : null;
const base = `/api/v1/deployments/${DEPLOYMENT_ID}`;
const auth = { Authorization: `Bearer ${TOKEN}` };

type EventItem = {
  eventId: string;
  kind: string;
  topic: string | null;
  txHash: string;
  data: unknown;
};
type EventsPage = { items: EventItem[]; nextCursor: string | null; hasMore: boolean };

async function poll<T>(fn: () => Promise<T | null>, ms: number, every = 3000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out after ${ms}ms`);
}

async function rpcGetTransaction(hash: string) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }),
  });
  return (await res.json()).result as
    | {
        status: string;
        ledger?: number;
        events?: { contractEventsXdr?: string[][] | string[] };
      }
    | undefined;
}

/** Contract ids that emitted events in a transaction, from its result meta. */
function contractsEmittingEvents(
  tx: NonNullable<Awaited<ReturnType<typeof rpcGetTransaction>>>,
): string[] {
  const raw = tx.events?.contractEventsXdr ?? [];
  const flat = (raw as unknown[]).flat() as string[];
  const ids = new Set<string>();
  for (const b64 of flat) {
    try {
      const ev = xdr.ContractEvent.fromXDR(b64, "base64");
      const id = ev.contractId();
      if (id) ids.add(StrKey.encodeContract(id as unknown as Buffer));
    } catch {
      /* not a contract event */
    }
  }
  return [...ids];
}

async function events(request: APIRequestContext, query: string): Promise<EventsPage> {
  const r = await request.get(`${base}/events?${query}`, { headers: auth });
  expect(r.ok(), await r.text()).toBeTruthy();
  return (await r.json()).data as EventsPage;
}

test("refusals: the spec is public, the flow endpoints need the bearer", async ({ request }) => {
  const spec = await request.get("/api/v1/openapi.json");
  expect(spec.ok()).toBeTruthy();
  const specJson = await spec.json();
  expect(specJson.openapi).toMatch(/^3\.1/);

  const noToken = await request.get(`${base}/events`);
  expect(noToken.status()).toBe(401);
  const wrongToken = await request.get(`${base}/events`, {
    headers: { Authorization: `Bearer pfk_${"0".repeat(64)}` },
  });
  expect(wrongToken.status()).toBe(401);
  expect((await wrongToken.json()).error.code).toBe("UNAUTHENTICATED");

  await writeFile(`${OUT}/10-e2e-openapi.json`, JSON.stringify(specJson, null, 2));
});

test("happy path: prepare, sign locally, submit, swap on Soroswap, read the swap event", async ({
  request,
}) => {
  const prep = await request.post(`${base}/execute`, {
    headers: auth,
    data: { amount: AMOUNT, from: depositor!.publicKey() },
  });
  expect(prep.ok(), await prep.text()).toBeTruthy();
  const prepared = (await prep.json()).data as {
    xdr: string;
    networkPassphrase: string;
    network: string;
    expiresAt: string;
  };
  expect(prepared.network).toBe("testnet");

  const tx = TransactionBuilder.fromXDR(prepared.xdr, prepared.networkPassphrase);
  tx.sign(depositor!);
  const signedXdr = tx.toXDR();

  const sub = await request.post(`${base}/execute/submit`, {
    headers: auth,
    data: { signedXdr },
    timeout: 60_000,
  });
  expect(sub.ok(), await sub.text()).toBeTruthy();
  let submitted = (await sub.json()).data as { txHash: string; status: string; ledger?: number };

  // PENDING means accepted but not final; resubmitting the same envelope reports on the first.
  if (submitted.status === "PENDING") {
    submitted = await poll(async () => {
      const again = await request.post(`${base}/execute/submit`, {
        headers: auth,
        data: { signedXdr },
        timeout: 60_000,
      });
      const d = (await again.json()).data as typeof submitted;
      return d.status === "PENDING" ? null : d;
    }, 90_000);
  }
  expect(submitted.status).toBe("SUCCESS");

  // The public RPC can lag the app's, so a transient NOT_FOUND (or a JSON-RPC error) is retried.
  const chainTx = await poll(async () => {
    const r = await rpcGetTransaction(submitted.txHash);
    return r?.status === "SUCCESS" || r?.status === "FAILED" ? r : null;
  }, 60_000);
  expect(chainTx.status).toBe("SUCCESS");
  const emitters = contractsEmittingEvents(chainTx);
  expect(emitters, "the Soroswap router emitted an event in the execute tx").toContain(ROUTER);

  const byTx = await poll(async () => {
    const page = await events(request, `txHash=${submitted.txHash}&limit=100`);
    return page.items.some((e) => e.topic === "swap") ? page : null;
  }, 120_000);
  const swapEvent = byTx.items.find((e) => e.topic === "swap");
  expect(swapEvent?.kind).toBe("PAYOUT");

  // Walk the whole feed forward with the cursor; the last page echoes the cursor back.
  let cursor: string | null = null;
  let pages = 0;
  let seenSwap = false;
  let last: EventsPage;
  do {
    last = await events(
      request,
      `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    seenSwap ||= last.items.some((e) => e.eventId === swapEvent!.eventId);
    cursor = last.nextCursor;
    pages++;
  } while (last.hasMore && pages < 50);
  expect(seenSwap, "the swap event is in the cursor-paged feed").toBeTruthy();
  const caughtUp = await events(request, `limit=100&cursor=${encodeURIComponent(cursor ?? "")}`);
  expect(caughtUp.items).toHaveLength(0);
  expect(caughtUp.nextCursor).toBe(cursor);

  await writeFile(
    `${OUT}/10-e2e-api-run.json`,
    JSON.stringify(
      {
        baseUrl: test.info().project.use.baseURL,
        deploymentId: DEPLOYMENT_ID,
        from: depositor!.publicKey(),
        amountStroops: AMOUNT,
        prepareResponse: prepared,
        signedXdr,
        submitResponse: submitted,
        contractsEmittingEvents: emitters,
        soroswapRouter: ROUTER,
        eventsByTxHash: byTx,
        eventsCaughtUp: caughtUp,
        stellarExpert: `https://stellar.expert/explorer/testnet/tx/${submitted.txHash}`,
      },
      null,
      2,
    ),
  );
  await writeFile(`${OUT}/10-e2e-api-run.getTransaction.json`, JSON.stringify(chainTx, null, 2));
});
