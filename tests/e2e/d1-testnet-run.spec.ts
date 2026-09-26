/**
 * Instawards D1 (#390 Stage 2): deploy an `on_receive XLM → swap → pay USDC`
 * flow through the app's own API on Stellar testnet, trigger it with a real
 * deposit, and prove the swap went through the Soroswap router. The 0 bps
 * negative is gone (#453): such a flow can no longer be saved, which
 * `tests/e2e/swap-panel.spec.ts` asserts, and the revert itself is proven by
 * the swapper crate's `zero_slippage_reverts_on_the_pool_fee_alone`.
 *
 * A throwaway testnet key signs in place of the browser wallet; the deploy and
 * trigger transactions are exactly the ones the UI would hand to Freighter.
 * Writes evidence JSON into docs/instawards/evidence/d1/. Manual; never in CI.
 *
 *   PLAYWRIGHT_NO_SERVER=1 ADMIN_SEED_PASSWORD=… D1_DEPOSITOR_SECRET=S… \
 *   D1_RECIPIENT=G… CRON_SECRET=… DATABASE_URL=… pnpm exec playwright test \
 *     tests/e2e/d1-testnet-run.spec.ts --project=chromium-desktop
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Keypair, Networks, TransactionBuilder, xdr, StrKey } from "@stellar/stellar-sdk";
import { writeFile } from "node:fs/promises";

const OUT = "docs/instawards/evidence/d1";
const RPC = "https://soroban-testnet.stellar.org";
const HORIZON = "https://horizon-testnet.stellar.org";
const ROUTER = process.env.STELLAR_SOROSWAP_ROUTER_TESTNET ?? "";
const DEPOSITOR_SECRET = process.env.D1_DEPOSITOR_SECRET ?? "";
const RECIPIENT = process.env.D1_RECIPIENT ?? "";
const XLM = { kind: "native" };
const USDC = { kind: "known", symbol: "USDC" };

test.skip(
  !DEPOSITOR_SECRET || !RECIPIENT || !ROUTER,
  "needs D1_DEPOSITOR_SECRET, D1_RECIPIENT, STELLAR_SOROSWAP_ROUTER_TESTNET",
);
test.describe.configure({ mode: "serial" });
test.setTimeout(420_000);

const depositor = DEPOSITOR_SECRET ? Keypair.fromSecret(DEPOSITOR_SECRET) : null;

function graph(slippageBps: number) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: XLM } },
      {
        id: "s",
        type: "swap",
        config: { assetIn: XLM, assetOut: USDC, slippageBps, deadlineSecs: 300 },
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
}

function sign(unsignedXdr: string): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(depositor!);
  return tx.toXDR();
}

async function poll<T>(fn: () => Promise<T | null>, ms: number, every = 2000): Promise<T> {
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
  return (await res.json()).result as {
    status: string;
    ledger?: number;
    events?: { contractEventsXdr?: string[][] | string[] };
  };
}

async function usdcBalance(account: string): Promise<string> {
  const res = await fetch(`${HORIZON}/accounts/${account}`);
  const json = (await res.json()) as { balances: Array<{ asset_code?: string; balance: string }> };
  return json.balances.find((b) => b.asset_code === "USDC")?.balance ?? "0";
}

/** Contract ids that emitted events in a transaction, from its result meta. */
function contractsEmittingEvents(tx: Awaited<ReturnType<typeof rpcGetTransaction>>): string[] {
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

async function deployFlow(request: APIRequestContext, name: string, slippageBps: number) {
  const created = await request.post("/api/flows", { data: { name, graph: graph(slippageBps) } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const flowId = (await created.json()).data.id as string;

  const prep = await request.post("/api/deployments/prepare", {
    data: { flowId, sourceAccount: depositor!.publicKey() },
  });
  expect(prep.ok(), await prep.text()).toBeTruthy();
  const prepData = (await prep.json()).data as {
    xdr: string;
    deploymentId: string;
    pipeline: unknown;
  };

  const submit = await request.post(`/api/deployments/${prepData.deploymentId}/submit`, {
    data: { signedXdr: sign(prepData.xdr) },
  });
  expect(submit.ok(), await submit.text()).toBeTruthy();

  const status = await poll(async () => {
    const r = await request.get(`/api/deployments/${prepData.deploymentId}/status`);
    // This route returns { status } bare, not the { data } envelope (CLAUDE.md §19).
    const j = (await r.json()) as { status?: string; data?: { status?: string } };
    const s = j.status ?? j.data?.status;
    return s === "CONFIRMED" || s === "FAILED" ? s : null;
  }, 120_000);
  expect(status).toBe("CONFIRMED");

  const dep = await request.get(`/api/deployments/${prepData.deploymentId}`);
  const depJson = (await dep.json()).data as {
    deployTxHash?: string;
    pipelineSnapshot?: Array<{ nodeId: string; contractAddress: string; templateKind: string }>;
  };
  return { flowId, deploymentId: prepData.deploymentId, deployment: depJson };
}

test("happy path: deploy, deposit 10 XLM, swap on Soroswap, pay USDC to the recipient", async ({
  request,
}) => {
  const before = await usdcBalance(RECIPIENT);
  const { flowId, deploymentId, deployment } = await deployFlow(request, "D1 testnet proof", 100);
  const swapper = deployment.pipelineSnapshot?.find((n) => n.templateKind === "SWAPPER");
  expect(swapper?.contractAddress).toBeTruthy();

  const trig = await request.post(`/api/deployments/${deploymentId}/trigger`, {
    data: { amount: "100000000", userAddress: depositor!.publicKey() },
  });
  expect(trig.ok(), await trig.text()).toBeTruthy();
  const trigXdr = (await trig.json()).data.xdr as string;
  const sub = await request.post(`/api/deployments/${deploymentId}/submit-trigger`, {
    data: { signedXdr: sign(trigXdr) },
  });
  expect(sub.ok(), await sub.text()).toBeTruthy();
  const txHash = (await sub.json()).data.txHash as string;

  const txStatus = await poll(async () => {
    const r = await request.get(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`);
    const s = (await r.json()).data?.status as string | undefined;
    return s === "SUCCESS" || s === "FAILED" ? s : null;
  }, 90_000);
  expect(txStatus).toBe("SUCCESS");

  const tx = await rpcGetTransaction(txHash);
  expect(tx.status).toBe("SUCCESS");
  const emitters = contractsEmittingEvents(tx);
  expect(emitters, "the Soroswap router emitted an event in the trigger tx").toContain(ROUTER);
  expect(emitters).toContain(swapper!.contractAddress);

  // Let the app ingest the on-chain events, then read them back.
  const cron = await request.post("/api/cron/poll-events", {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  expect(cron.ok(), await cron.text()).toBeTruthy();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const events = await db.contractEvent.findMany({
    where: { deploymentId },
    select: { kind: true, decodedData: true, txHash: true },
  });
  await db.$disconnect();
  const swapEvent = events.find(
    (e) => e.kind === "PAYOUT" && (e.decodedData as { assetIn?: string })?.assetIn,
  );
  expect(swapEvent, "a decoded swap event is in ContractEvent").toBeTruthy();

  const after = await poll(async () => {
    const b = await usdcBalance(RECIPIENT);
    return Number(b) > Number(before) ? b : null;
  }, 30_000);

  await writeFile(
    `${OUT}/11-happy-path.json`,
    JSON.stringify(
      {
        flowId,
        deploymentId,
        deployTxHash: deployment.deployTxHash,
        pipelineSnapshot: deployment.pipelineSnapshot,
        triggerTxHash: txHash,
        ledger: tx.ledger,
        contractsEmittingEvents: emitters,
        soroswapRouter: ROUTER,
        recipient: RECIPIENT,
        recipientUsdcBefore: before,
        recipientUsdcAfter: after,
        swapEvent: swapEvent?.decodedData,
        stellarExpert: `https://stellar.expert/explorer/testnet/tx/${txHash}`,
      },
      null,
      2,
    ),
  );
  await writeFile(`${OUT}/11-happy-path.getTransaction.json`, JSON.stringify(tx, null, 2));
});
