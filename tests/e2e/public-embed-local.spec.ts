import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { encode } from "next-auth/jwt";

test.skip(
  process.env.PUBLIC_EMBED_LOCAL_TEST !== "1",
  "Requires explicit disposable local fixture mode",
);

test("public QR, safe HTML/RSC, cross-context updates, reconnect and slot cleanup", async ({
  browser,
  baseURL,
}) => {
  const database = new URL(process.env.DATABASE_URL ?? "http://missing");
  const redisUrl = new URL(process.env.REDIS_URL ?? "http://missing");
  for (const url of [database, redisUrl, new URL(baseURL!)])
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(database.pathname).toMatch(/^\/public_embed_/);
  const secret = process.env.AUTH_SECRET;
  expect(secret && secret.length >= 32).toBeTruthy();
  const db = new PrismaClient();
  const redis = new Redis(redisUrl.href);
  const id = randomUUID();
  const marker = "synthetic-private-577-marker";
  const owner = await db.user.create({
    data: { username: `embed-owner-${id}`, passwordHash: "synthetic-unused-hash" },
  });
  const other = await db.user.create({
    data: { username: `embed-other-${id}`, passwordHash: "synthetic-unused-hash" },
  });
  const sandbox = await db.user.create({
    data: {
      username: `embed-sandbox-${id}`,
      passwordHash: "synthetic-unused-hash",
      role: "SANDBOX",
    },
  });
  const graph = {
    notify: { mode: "every_transaction", sendTo: `${marker}@example.com` },
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: {
          recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset: { kind: "native" },
          fullAmount: true,
          email: `${marker}@example.com`,
        },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "pay" }],
  };
  const flow = await db.flow.create({
    data: {
      ownerId: owner.id,
      name: "Public embed fixture",
      templateKind: "SPLITTER",
      graph,
      parameters: {},
    },
  });
  const deployment = await db.deployment.create({
    data: {
      id,
      flowId: flow.id,
      ownerId: owner.id,
      status: "CONFIRMED",
      network: "testnet",
      contractAddress: "C" + "A".repeat(55),
      graphSnapshot: graph,
      paramsSnapshot: {},
      webhookSecret: marker,
      pipelineSnapshot: [
        {
          nodeId: "root",
          templateKind: "DEPOSIT_TRIGGER",
          contractAddress: "C" + "A".repeat(55),
          privateMetadata: marker,
        },
      ],
    },
  });
  await db.eventCursor.create({ data: { deploymentId: id, lastLedger: 10 } });
  const contexts = [];
  try {
    const anonymous = await browser.newContext({ baseURL });
    contexts.push(anonymous);
    const viewer = await anonymous.newPage();
    const privateReads: string[] = [];
    viewer.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith(`/api/deployments/${id}/`) &&
        !path.startsWith(`/api/deployments/${id}/embed/`)
      )
        privateReads.push(path);
    });
    const response = await viewer.goto(`/deployments/${id}/embed`);
    expect(await response!.text()).not.toContain(marker);
    await expect(viewer.getByRole("status")).toHaveText("LIVE");
    const image = viewer.getByAltText("Payment page QR code");
    await expect(image).toBeVisible();
    expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const qr = await anonymous.request.get(`/api/deployments/${id}/embed/qr`);
    expect(qr.status()).toBe(200);
    expect(await qr.text()).toContain("<svg");
    const rsc = await anonymous.request.get(`/deployments/${id}/embed`, { headers: { RSC: "1" } });
    expect(await rsc.text()).not.toContain(marker);

    // All authenticated viewers receive the same public projection.
    for (const user of [other, sandbox, owner]) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const cookie = "__Host-paiflow.session";
      const token = await encode({
        secret: secret!,
        salt: cookie,
        token: { id: user.id, role: user.role, username: user.username, sessionVersion: 0 },
      });
      await context.addCookies([
        {
          name: cookie,
          value: token,
          domain: new URL(baseURL!).hostname,
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      const res = await page.goto(`/deployments/${id}/embed`);
      expect(await res!.text()).not.toContain(marker);
      const session = await page.evaluate(async () => (await fetch("/api/auth/session")).json());
      expect(session.user.id).toBe(user.id);
      expect(session.user.role).toBe(user.role);
      await expect(page.getByRole("status")).toHaveText("LIVE");
      expect(await page.content()).not.toContain(marker);
    }

    const customer = await browser.newContext({ baseURL, viewport: { width: 393, height: 851 } });
    contexts.push(customer);
    const paymentPage = await customer.newPage();
    const href = await viewer.getByRole("link", { name: /Open payment page/ }).getAttribute("href");
    const paymentResponse = await paymentPage.goto(href!);
    expect(paymentResponse!.status()).toBe(200);
    await expect(paymentPage.getByTestId("trigger-amount")).toBeVisible();

    // Simulated ingestion from another context, not a real wallet payout.
    const inserted = await db.contractEvent.create({
      data: {
        deploymentId: deployment.id,
        eventId: `fixture-${id}`,
        kind: "PAYOUT",
        ledger: 11,
        txHash: "a".repeat(64),
        occurredAt: new Date(),
        payload: { secret: marker },
        decodedData: { amount: "17", secret: marker },
      },
    });
    await db.eventCursor.update({ where: { deploymentId: id }, data: { lastLedger: 11 } });
    await redis.publish(`events:${id}`, JSON.stringify(inserted));
    await expect(viewer.getByRole("listitem")).toHaveCount(1);
    expect(await viewer.content()).not.toContain(marker);
    const catchup = await anonymous.request.get(`/api/deployments/${id}/embed/activity`);
    expect(await catchup.text()).not.toContain(marker);
    await viewer.reload();
    await expect(viewer.getByRole("status")).toHaveText("LIVE");
    await expect(viewer.getByRole("listitem")).toHaveCount(1);
    expect(privateReads).toEqual([]);
    for (const endpoint of ["events", "poll-events", "qr", "sep7", "balances"]) {
      expect((await anonymous.request.get(`/api/deployments/${id}/${endpoint}`)).status()).toBe(
        401,
      );
    }
  } finally {
    for (const context of contexts) await context.close();
    await expect.poll(() => redis.zcard(`public-embed:streams:deployment:${id}`)).toBe(0);
    await db.deployment.delete({ where: { id } });
    await db.flow.delete({ where: { id: flow.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id, sandbox.id] } } });
    await redis.quit();
    await db.$disconnect();
  }
});
