/**
 * Instawards week 4 (#692): the three deliverables end to end on ONE deployment
 * of the public app. Deploy an `on_receive XLM → swap → pay USDC` flow through
 * the app's API (D1), trigger it with a deposit (D1), then mint a deployment
 * token the way the API access panel does and execute the same deployment
 * through `/api/v1` with nothing but that token (D2).
 *
 * A throwaway testnet key signs in place of the browser wallet; every envelope
 * is the one the UI would hand to Freighter, and each is written to the pack in
 * full, unsigned and signed, for the integration guide (#694). The Freighter
 * half of the week-4 E2E is the recorded run (#693).
 *
 * Reads events through the public `/api/v1` feed, not the database, so it runs
 * against paiflow.xyz. Writes into docs/instawards/evidence/d4/; the token is
 * revoked at the end and never written, nor is the depositor seed. Manual;
 * never in CI.
 *
 *   PLAYWRIGHT_NO_SERVER=1 PLAYWRIGHT_BASE_URL=https://paiflow.xyz \
 *   ADMIN_SEED_USERNAME=… ADMIN_SEED_PASSWORD=… \
 *   D4_DEPOSITOR_SECRET=S… D4_RECIPIENT=G… \
 *   STELLAR_SOROSWAP_ROUTER_TESTNET=C… pnpm exec playwright test \
 *     tests/e2e/d4-end-to-end.spec.ts --project=chromium-desktop
 *
 * D4_RECIPIENT must hold a trustline for testnet USDC from
 * GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5; D4_AMOUNT_STROOPS
 * (default 10 XLM) is deposited twice, once per leg.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Keypair, Networks, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "docs/instawards/evidence/d4";
const RPC = "https://soroban-testnet.stellar.org";
const ROUTER = process.env.STELLAR_SOROSWAP_ROUTER_TESTNET ?? "";
const DEPOSITOR_SECRET = process.env.D4_DEPOSITOR_SECRET ?? "";
const RECIPIENT = process.env.D4_RECIPIENT ?? "";
const AMOUNT = process.env.D4_AMOUNT_STROOPS ?? "100000000";
const XLM = { kind: "native" };
const USDC = { kind: "known", symbol: "USDC" };

test.skip(
  !DEPOSITOR_SECRET || !RECIPIENT || !ROUTER,
  "needs D4_DEPOSITOR_SECRET, D4_RECIPIENT, STELLAR_SOROSWAP_ROUTER_TESTNET",
);
test.setTimeout(600_000);

const depositor = DEPOSITOR_SECRET ? Keypair.fromSecret(DEPOSITOR_SECRET) : null;

const graph = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "s",
      type: "swap",
      config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
    },
    {
      id: "p",
      type: "pay",
      config: {
        recipient: RECIPIENT,
        asset: USDC,
        mode: "fixed",
        amountStroops: "1000000",
        fullAmount: true,
      },
    },
  ],
  edges: [
    { id: "e1", source: "t", target: "s" },
    { id: "e2", source: "s", target: "p" },
  ],
};

type ChainTx = {
  status: string;
  ledger?: number;
  events?: { contractEventsXdr?: string[][] | string[] };
};
type EventItem = { eventId: string; kind: string; topic: string | null; txHash: string };
type EventsPage = { items: EventItem[]; nextCursor: string | null; hasMore: boolean };

function sign(unsignedXdr: string, passphrase: string = Networks.TESTNET): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, passphrase);
  tx.sign(depositor!);
  return tx.toXDR();
}

async function poll<T>(fn: () => Promise<T | null>, ms: number, every = 3000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out after ${ms}ms`);
}

/** The public RPC can lag the app's, so NOT_FOUND and JSON-RPC errors are retried. */
async function chainTx(hash: string): Promise<ChainTx> {
  return poll(async () => {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash } }),
    });
    const r = (await res.json()).result as ChainTx | undefined;
    return r?.status === "SUCCESS" || r?.status === "FAILED" ? r : null;
  }, 90_000);
}

/** Contract ids that emitted events in a transaction, from its result meta. */
function contractsEmittingEvents(tx: ChainTx): string[] {
  const flat = ((tx.events?.contractEventsXdr ?? []) as unknown[]).flat() as string[];
  const ids = new Set<string>();
  for (const b64 of flat) {
    try {
      const id = xdr.ContractEvent.fromXDR(b64, "base64").contractId();
      if (id) ids.add(StrKey.encodeContract(id as unknown as Buffer));
    } catch {
      /* not a contract event */
    }
  }
  return [...ids];
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).data as T;
}

async function write(name: string, value: unknown) {
  await writeFile(`${OUT}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
}

test("one deployment: deploy, trigger in the app, then execute through /api/v1 with a token", async ({
  request,
  playwright,
}) => {
  await mkdir(OUT, { recursive: true });
  const baseURL = test.info().project.use.baseURL;
  const explorer = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;

  // ── D1: deploy ──────────────────────────────────────────────────────────
  const flow = await ok<{ id: string }>(
    await request.post("/api/flows", { data: { name: "D4 end-to-end", graph } }),
  );
  const prepared = await ok<{ xdr: string; deploymentId: string }>(
    await request.post("/api/deployments/prepare", {
      data: { flowId: flow.id, sourceAccount: depositor!.publicKey() },
    }),
  );
  const deploymentId = prepared.deploymentId;
  const deploySigned = sign(prepared.xdr);
  await ok(
    await request.post(`/api/deployments/${deploymentId}/submit`, {
      data: { signedXdr: deploySigned },
    }),
  );
  const status = await poll(async () => {
    const r = await request.get(`/api/deployments/${deploymentId}/status`);
    // This route returns { status } bare, not the { data } envelope (CLAUDE.md §19).
    const j = (await r.json()) as { status?: string; data?: { status?: string } };
    const s = j.status ?? j.data?.status;
    return s === "CONFIRMED" || s === "FAILED" ? s : null;
  }, 180_000);
  expect(status).toBe("CONFIRMED");
  const deployment = await ok<{
    deployTxHash?: string;
    pipelineSnapshot?: Array<{ nodeId: string; contractAddress: string; templateKind: string }>;
  }>(await request.get(`/api/deployments/${deploymentId}`));
  const swapper = deployment.pipelineSnapshot?.find((n) => n.templateKind === "SWAPPER");
  expect(swapper?.contractAddress).toBeTruthy();
  const deployTx = await chainTx(deployment.deployTxHash!);
  expect(deployTx.status).toBe("SUCCESS");

  await write("01-e2e-deploy.json", {
    baseUrl: baseURL,
    flowId: flow.id,
    graph,
    deploymentId,
    sourceAccount: depositor!.publicKey(),
    unsignedXdr: prepared.xdr,
    signedXdr: deploySigned,
    deployTxHash: deployment.deployTxHash,
    pipelineSnapshot: deployment.pipelineSnapshot,
    stellarExpert: explorer(deployment.deployTxHash!),
  });
  await write("01-e2e-deploy.getTransaction.json", deployTx);

  // ── D1: trigger from the app ────────────────────────────────────────────
  const trigger = await ok<{ xdr: string }>(
    await request.post(`/api/deployments/${deploymentId}/trigger`, {
      data: { amount: AMOUNT, userAddress: depositor!.publicKey() },
    }),
  );
  const triggerSigned = sign(trigger.xdr);
  const triggerSub = await ok<{ txHash: string }>(
    await request.post(`/api/deployments/${deploymentId}/submit-trigger`, {
      data: { signedXdr: triggerSigned },
    }),
  );
  const triggerTx = await chainTx(triggerSub.txHash);
  expect(triggerTx.status).toBe("SUCCESS");
  const triggerEmitters = contractsEmittingEvents(triggerTx);
  expect(triggerEmitters, "the Soroswap router emitted an event").toContain(ROUTER);
  expect(triggerEmitters).toContain(swapper!.contractAddress);

  await write("02-e2e-trigger.json", {
    deploymentId,
    amountStroops: AMOUNT,
    unsignedXdr: trigger.xdr,
    signedXdr: triggerSigned,
    txHash: triggerSub.txHash,
    ledger: triggerTx.ledger,
    contractsEmittingEvents: triggerEmitters,
    soroswapRouter: ROUTER,
    stellarExpert: explorer(triggerSub.txHash),
  });
  await write("02-e2e-trigger.getTransaction.json", triggerTx);

  // ── D2: a token, then /api/v1 with nothing else ─────────────────────────
  const created = await ok<{
    id: string;
    tokenPrefix: string;
    expiresAt: string | null;
    token: string;
  }>(
    await request.post(`/api/deployments/${deploymentId}/api-tokens`, {
      data: { label: "D4 end-to-end", expiresInDays: 1 },
    }),
  );
  const partner = await playwright.request.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Authorization: `Bearer ${created.token}` },
  });
  const base = `/api/v1/deployments/${deploymentId}`;
  try {
    const exec = await ok<{
      xdr: string;
      networkPassphrase: string;
      network: string;
      expiresAt: string;
    }>(
      await partner.post(`${base}/execute`, {
        data: { amount: AMOUNT, from: depositor!.publicKey() },
      }),
    );
    expect(exec.network).toBe("testnet");
    const execSigned = sign(exec.xdr, exec.networkPassphrase);

    const submitOnce = async () =>
      ok<{ txHash: string; status: string; ledger?: number }>(
        await partner.post(`${base}/execute/submit`, {
          data: { signedXdr: execSigned },
          timeout: 60_000,
        }),
      );
    // PENDING means accepted but not final; resubmitting the same envelope reports on the first.
    let submitted = await submitOnce();
    if (submitted.status === "PENDING") {
      submitted = await poll(async () => {
        const d = await submitOnce();
        return d.status === "PENDING" ? null : d;
      }, 90_000);
    }
    expect(submitted.status).toBe("SUCCESS");

    const execTx = await chainTx(submitted.txHash);
    expect(execTx.status).toBe("SUCCESS");
    const execEmitters = contractsEmittingEvents(execTx);
    expect(execEmitters, "the Soroswap router emitted an event").toContain(ROUTER);

    // Both legs' swaps are in the one deployment's feed.
    const eventsFor = (hash: string) =>
      poll(async () => {
        const page = await ok<EventsPage>(
          await partner.get(`${base}/events?txHash=${hash}&limit=100`),
        );
        return page.items.some((e) => e.topic === "swap") ? page : null;
      }, 180_000);
    const triggerEvents = await eventsFor(triggerSub.txHash);
    const execEvents = await eventsFor(submitted.txHash);

    await write("03-e2e-api-execute.json", {
      deploymentId,
      token: { id: created.id, tokenPrefix: created.tokenPrefix, expiresAt: created.expiresAt },
      from: depositor!.publicKey(),
      amountStroops: AMOUNT,
      prepareResponse: exec,
      signedXdr: execSigned,
      submitResponse: submitted,
      contractsEmittingEvents: execEmitters,
      soroswapRouter: ROUTER,
      eventsForTriggerTx: triggerEvents,
      eventsForExecuteTx: execEvents,
      stellarExpert: explorer(submitted.txHash),
    });
    await write("03-e2e-api-execute.getTransaction.json", execTx);
  } finally {
    await partner.dispose();
    const revoked = await request.delete(
      `/api/deployments/${deploymentId}/api-tokens/${created.id}`,
    );
    expect(revoked.ok(), await revoked.text()).toBeTruthy();
  }
});
