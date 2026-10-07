import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  Asset,
  Keypair,
  Networks,
  StrKey,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { encode } from "next-auth/jwt";

test.skip(
  process.env.PUBLIC_ALLOWANCE_LOCAL_TEST !== "1",
  "Requires explicit disposable local fixture mode and synthetic RPC preload",
);

test("anonymous ordinary/Dev allowance pages, exact signed submission, current subscriber and private boundaries", async ({
  browser,
  baseURL,
}) => {
  const database = new URL(process.env.DATABASE_URL ?? "http://missing");
  for (const url of [database, new URL(baseURL!)])
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(database.pathname).toMatch(/^\/public_allowance_/);
  const statePath = process.env.PUBLIC_ALLOWANCE_STATE_PATH;
  expect(statePath).toBeTruthy();
  const db = new PrismaClient();
  const id = randomUUID();
  const marker = `synthetic-private-${id}`;
  const owner = await db.user.create({
    data: { username: `allowance-owner-${id}`, passwordHash: "synthetic-unused-hash" },
  });
  const other = await db.user.create({
    data: { username: `allowance-other-${id}`, passwordHash: "synthetic-unused-hash" },
  });
  const sandbox = await db.user.create({
    data: {
      username: `allowance-sandbox-${id}`,
      passwordHash: "synthetic-unused-hash",
      role: "SANDBOX",
    },
  });
  const subscriber = Keypair.random();
  const changed = Keypair.random();
  const original = Keypair.random().publicKey();
  const ordinary = StrKey.encodeContract(randomBytes(32));
  const dev = StrKey.encodeContract(randomBytes(32));
  const token = Asset.native().contractId(Networks.TESTNET);
  const subscribers: Record<string, string | null> = {
    [ordinary]: subscriber.publicKey(),
    [dev]: null,
  };
  const setState = () => writeFileSync(statePath!, JSON.stringify({ token, subscribers }));
  setState();
  const graph = {
    nodes: [
      {
        id: "root",
        type: "subscription",
        config: { subscriber: original, asset: { kind: "native" }, amountPerPeriodStroops: "100" },
      },
    ],
    edges: [],
    notify: { mode: "every_transaction", sendTo: `${marker}@example.com` },
  };
  const contexts = [];
  const deployments: string[] = [];
  const flows: string[] = [];
  try {
    for (const [kind, contract] of [
      ["SUBSCRIPTION", ordinary],
      ["SUBSCRIPTION_DEV", dev],
    ] as const) {
      const flow = await db.flow.create({
        data: {
          ownerId: owner.id,
          name: `Allowance ${kind}`,
          templateKind: "SUBSCRIPTION",
          graph,
          parameters: {},
        },
      });
      flows.push(flow.id);
      const deployment = await db.deployment.create({
        data: {
          ownerId: owner.id,
          flowId: flow.id,
          status: "CONFIRMED",
          network: "testnet",
          contractAddress: contract,
          graphSnapshot: graph,
          paramsSnapshot: {},
          webhookSecret: marker,
          pipelineSnapshot: [
            {
              nodeId: "root",
              contractAddress: contract,
              templateKind: kind,
              privateMetadata: marker,
            },
          ],
        },
      });
      deployments.push(deployment.id);
    }
    const anonymous = await browser.newContext({ baseURL });
    contexts.push(anonymous);
    const page = await anonymous.newPage();
    const first = await page.goto(`/allowance/${deployments[0]}`);
    expect(first!.status()).toBe(200);
    expect(await first!.text()).not.toContain(marker);
    await expect(page.getByTestId("network-chip")).toContainText("TESTNET");
    await expect(page.getByText(subscriber.publicKey(), { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "CONNECT WALLET & APPROVE" })).toBeVisible();
    const rsc = await anonymous.request.get(`/allowance/${deployments[0]}`, {
      headers: { RSC: "1" },
    });
    expect(await rsc.text()).not.toContain(marker);
    for (const endpoint of ["invoke", "submit-invoke", "subscription-charge"])
      expect(
        (
          await anonymous.request.post(`/api/deployments/${deployments[0]}/${endpoint}`, {
            data: {},
          })
        ).status(),
      ).toBe(401);
    expect(
      (
        await anonymous.request.post(`/api/deployments/${deployments[0]}/dev-subscription`, {
          data: {},
        })
      ).status(),
    ).toBe(401);
    await page.goto(`/allowance/${deployments[1]}`);
    await expect(page.getByText(/configure the Dev subscriber/)).toBeVisible();
    await expect(page.getByRole("button", { name: "CONNECT WALLET & APPROVE" })).toBeDisabled();
    subscribers[dev] = changed.publicKey();
    setState();
    await page.reload();
    await expect(page.getByText(changed.publicKey(), { exact: false })).toBeVisible();
    expect(
      (
        await anonymous.request.post(`/api/deployments/${deployments[1]}/subscription-allowance`, {
          data: { amount: "200", userAddress: subscriber.publicKey() },
        })
      ).status(),
    ).toBe(403);
    for (const [index, wallet] of [subscriber, changed].entries()) {
      const deploymentId = deployments[index]!;
      const prepare = await anonymous.request.post(
        `/api/deployments/${deploymentId}/subscription-allowance`,
        { data: { amount: "200", userAddress: wallet.publicKey() } },
      );
      expect(prepare.status()).toBe(200);
      const prepared = (await prepare.json()).data;
      expect(prepared.allowance).toBe("300");
      const transaction = TransactionBuilder.fromXDR(prepared.xdr, Networks.TESTNET) as Transaction;
      transaction.sign(wallet);
      const signedXdr = transaction.toXDR();
      expect(
        (
          await anonymous.request.post(
            `/api/deployments/${deployments[1 - index]}/subscription-allowance/submit`,
            { data: { signedXdr, intent: prepared.intent } },
          )
        ).status(),
      ).toBe(422);
      const submitted = await anonymous.request.post(
        `/api/deployments/${deploymentId}/subscription-allowance/submit`,
        { data: { signedXdr, intent: prepared.intent } },
      );
      expect(submitted.status()).toBe(200);
      expect((await submitted.json()).data.txHash).toBe(prepared.txHash);
      const status = await anonymous.request.get(
        `/api/deployments/${deploymentId}/subscription-allowance/status?intent=${encodeURIComponent(prepared.intent)}`,
      );
      expect(status.status()).toBe(200);
      expect((await status.json()).data.status).toBe("SUCCESS");
      const replay = await anonymous.request.post(
        `/api/deployments/${deploymentId}/subscription-allowance/submit`,
        { data: { signedXdr, intent: prepared.intent } },
      );
      expect((await replay.json()).data.status).toBe("SUCCESS");
      const row = await db.signedTransaction.findUnique({ where: { txHash: prepared.txHash } });
      expect(row).toMatchObject({
        userId: null,
        signerAddress: wallet.publicKey(),
        deploymentId,
        signedBySource: true,
      });
    }
    for (const user of [other, sandbox]) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const cookie = "__Host-paiflow.session";
      const jwt = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: cookie,
        token: { id: user.id, role: user.role, username: user.username, sessionVersion: 0 },
      });
      await context.addCookies([
        {
          name: cookie,
          value: jwt,
          domain: new URL(baseURL!).hostname,
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
      const view = await context.newPage();
      await view.goto(`/allowance/${deployments[0]}`);
      if (user.role === "SANDBOX") expect(view.url()).toContain("/dashboard");
      else
        await expect(view.getByRole("button", { name: "CONNECT WALLET & APPROVE" })).toBeVisible();
      expect(
        (
          await context.request.get(`/api/deployments/${deployments[0]}/subscription-allowance`)
        ).status(),
      ).toBe(user.role === "SANDBOX" ? 403 : 200);
    }
  } finally {
    for (const context of contexts) await context.close();
    await db.deployment.deleteMany({ where: { id: { in: deployments } } });
    await db.flow.deleteMany({ where: { id: { in: flows } } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id, sandbox.id] } } });
    await db.$disconnect();
  }
});
