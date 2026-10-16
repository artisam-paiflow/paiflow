import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import axe from "axe-core";
import Redis from "ioredis";

import type { Paiflow as Client } from "../../packages/sdk/src/index";

// Never run against an ordinary development database. The runner creates this prefix.
test.beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? "http://missing");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.port).toBe("55439");
  expect(url.pathname).toMatch(/^\/dev_token_verify_[a-f0-9]{12}$/);
});

test("panel → real HTTP → installed SDK: two selections, live authorization and retained recovery", async ({
  browser,
  baseURL,
}) => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const users = await Promise.all(
    ["owner", "foreign", "sandbox"].map((name) =>
      db.user.create({
        data: {
          username: `${name}-${suffix}`,
          passwordHash: "unused-synthetic-fixture",
          role: name === "sandbox" ? "SANDBOX" : "USER",
        },
      }),
    ),
  );
  const owner = users[0]!;
  const graph = {
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "pay",
        type: "pay",
        config: {
          recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          asset: { kind: "native" },
          fullAmount: true,
        },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "pay" }],
  };
  const deployments = [];
  for (let i = 0; i < 4; i++) {
    const user = i === 3 ? users[1]! : owner;
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: `Verification ${i}`,
        templateKind: "SPLITTER",
        graph,
        parameters: {},
      },
    });
    deployments.push(
      await db.deployment.create({
        data: {
          ownerId: user.id,
          flowId: flow.id,
          status: "CONFIRMED",
          network: "testnet",
          graphSnapshot: graph,
          paramsSnapshot: {},
          pipelineSnapshot: [
            {
              nodeId: "root",
              templateKind: "DEPOSIT_TRIGGER",
              contractAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
            },
          ],
          webhookSecret: "synthetic-private-webhook-marker",
        },
      }),
    );
  }
  const [a, b, unselected, foreign] = deployments;
  const context = await browser.newContext({ baseURL });
  const cookie = "paiflow.session";
  async function session(user: typeof owner, target = context) {
    await target.addCookies([
      {
        name: cookie,
        value: await encode({
          secret: process.env.AUTH_SECRET!,
          salt: cookie,
          token: { id: user.id, role: user.role, username: user.username, sessionVersion: 0 },
        }),
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  await session(owner);
  const page = await context.newPage();
  // Capture only console message strings; never record network bodies or headers.
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { fixtureClipboard?: string }).fixtureClipboard = value;
        },
      },
      configurable: true,
    });
  });
  await page.goto("/account/developer");
  await page.getByLabel("Label (optional)").fill("Integrated verification");
  await page.getByRole("checkbox", { name: /Verification 0/ }).check();
  await page.getByRole("checkbox", { name: /Verification 1/ }).check();
  const generate = page.getByRole("button", { name: "Generate token" });
  // Measure actual CSS utility resolution, including contrast, in the real browser.
  const colors = await generate.evaluate((node) => {
    const s = getComputedStyle(node);
    return { foreground: s.color, background: s.backgroundColor };
  });
  const luminance = (rgb: string) =>
    rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((x) => {
        const s = x / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i]!, 0);
  const l = [luminance(colors.foreground), luminance(colors.background)].sort((x, y) => y - x);
  expect((l[0]! + 0.05) / (l[1]! + 0.05)).toBeGreaterThanOrEqual(4.5);
  await generate.focus();
  await page.keyboard.press("Enter");
  const reveal = page.getByTestId("developer-token-reveal");
  await expect(reveal).toBeFocused();
  expect(await reveal.getAttribute("class")).toContain("ph-no-capture");
  const token = (await reveal.locator("code").first().textContent())!;
  expect(/^pfd_[a-f0-9]{64}$/.test(token)).toBe(true);
  await page.getByRole("button", { name: "Copy token", exact: true }).click();
  expect(
    await page.evaluate((secret) => {
      const target = window as typeof window & { fixtureClipboard?: string };
      const matches = target.fixtureClipboard === secret;
      delete target.fixtureClipboard;
      return matches;
    }, token),
  ).toBe(true);
  await page.getByRole("button", { name: "Done, hide token" }).click();
  expect((await page.content()).includes(token)).toBe(false);
  const tokenRow = await db.developerApiToken.findUniqueOrThrow({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
  });
  const api = async (path: string, credential = token, method = "GET", data?: unknown) =>
    context.request.fetch(`/api/v1/${path}`, {
      method,
      headers: { authorization: `Bearer ${credential}` },
      ...(data === undefined ? {} : { data }),
    });
  const caps = (id: string) => `deployments/${id}/capabilities`;
  for (const d of [a!, b!]) expect((await api(caps(d.id))).status()).toBe(200);
  for (const d of [unselected!, foreign!]) {
    const response = await api(caps(d.id));
    expect(response.status()).toBe(401);
    expect((await response.text()).includes(d.flowId)).toBe(false);
  }
  const installed = pathToFileURL(
    "/tmp/paiflow-dev-token-verify/node_modules/@paiflow/sdk/dist/index.js",
  ).href;
  const { Paiflow } = (await import(installed)) as { Paiflow: typeof Client };
  const client = new Paiflow({ baseUrl: baseURL!, token });
  const discovered = await client.deployments.list({ limit: 1 });
  expect(Object.keys(discovered.data.items[0]!).sort()).toEqual(["flowName", "id", "network"]);
  const ids: string[] = [];
  for await (const result of client.deployments.pages({ limit: 1 }, { maxPages: 3 }))
    ids.push(...result.data.items.map((d) => d.id));
  expect(ids.sort()).toEqual([a!.id, b!.id].sort());
  for (const d of [a!, b!])
    expect((await client.deployment(d.id).capabilities.get()).metadata.status).toBe(200);
  // Every actual operate route must refuse before body validation or financial work.
  const matrix = readFileSync("lib/api/v1/permissions.ts", "utf8");
  const operations = [...matrix.matchAll(/"POST ([^"]+)": "operate"/g)].map((match) => match[1]!);
  expect(operations.length).toBeGreaterThan(20);
  for (const path of operations) {
    expect((await api(`deployments/${a!.id}/${path}`, token, "POST", {})).status(), path).toBe(403);
  }
  expect(await db.signedTransaction.count()).toBe(0);
  const webhookRefusal = await context.request.post(`/api/webhooks/${b!.id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { escrow: true },
  });
  expect(webhookRefusal.status()).toBe(403);
  const edit = async (deploymentIds: string[]) => {
    const res = await context.request.patch(`/api/developer-tokens/${tokenRow.id}`, {
      data: { deploymentIds },
    });
    expect(res.status()).toBe(200);
  };
  // Warm missing grant refusal immediately followed by an owner selection edit.
  await edit([a!.id, b!.id, unselected!.id]);
  expect((await api(caps(unselected!.id))).status()).toBe(200);
  await edit([b!.id]);
  expect((await api(caps(a!.id))).status()).toBe(401);
  expect((await api(caps(b!.id))).status()).toBe(200);
  const hash = randomBytes(32).toString("hex");
  const signed = await db.signedTransaction.create({
    data: {
      txHash: hash,
      signerAddress: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      kind: "API_EXECUTE",
      network: "testnet",
      deploymentId: b!.id,
      developerApiTokenId: tokenRow.id,
      callerAccountId: owner.id,
      outcome: "CONFIRMED",
      ledger: 123,
      audience: "EXTERNAL",
    },
  });
  expect((await client.deployment(b!.id).transactions.get(hash)).data.status).toBe("SUCCESS");
  // Independent pfk integration retains its own scope.
  const pfk = `pfk_${randomBytes(32).toString("hex")}`;
  await db.deploymentApiToken.create({
    data: {
      tokenHash: createHash("sha256").update(pfk).digest("hex"),
      tokenPrefix: pfk.slice(0, 12),
      deploymentId: b!.id,
      createdById: owner.id,
    },
  });
  expect(
    (await new Paiflow({ baseUrl: baseURL!, token: pfk }).deployment(b!.id).transactions.get(hash))
      .data.status,
  ).toBe("SUCCESS");
  expect((await api(caps(b!.id), `pkdev_${"a".repeat(64)}`)).status()).toBe(401);
  // Fresh token exercises the real 60/min endpoint allowance alternating IDs.
  const minted = await context.request.post("/api/developer-tokens", {
    data: { permission: "READ_ONLY", deploymentIds: [a!.id, b!.id] },
  });
  expect(minted.status()).toBe(201);
  const rateToken = (await minted.json()).data.token as string;
  for (let i = 0; i < 60; i++)
    expect((await api(caps(i % 2 ? a!.id : b!.id), rateToken)).status()).toBe(200);
  expect((await api(caps(a!.id), rateToken)).status()).toBe(429);
  await db.user.update({ where: { id: owner.id }, data: { isActive: false } });
  expect((await api(caps(b!.id))).status()).toBe(401);
  await db.user.update({ where: { id: owner.id }, data: { isActive: true } });
  // Use a fresh credential for expiry so a prior negative-cache refusal cannot obscure the claim.
  const expiry = await context.request.post("/api/developer-tokens", {
    data: { permission: "READ_ONLY", deploymentIds: [b!.id] },
  });
  const expired = (await expiry.json()).data;
  expect((await api(caps(b!.id), expired.token)).status()).toBe(200);
  await db.developerApiToken.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(0) },
  });
  expect((await api(caps(b!.id), expired.token)).status()).toBe(401);
  const revoked = await context.request.delete(`/api/developer-tokens/${tokenRow.id}`);
  expect(revoked.status()).toBe(200);
  expect((await api(caps(b!.id))).status()).toBe(401);
  expect(
    (await db.signedTransaction.findUniqueOrThrow({ where: { id: signed.id } }))
      .developerApiTokenId,
  ).toBe(tokenRow.id);
  expect(
    (await new Paiflow({ baseUrl: baseURL!, token: pfk }).deployment(b!.id).transactions.get(hash))
      .data.status,
  ).toBe("SUCCESS");
  const metadata = await context.request.get(`/api/developer-tokens/${tokenRow.id}`);
  const text = await metadata.text();
  expect(text.includes(token)).toBe(false);
  expect(text.includes(tokenRow.tokenHash)).toBe(false);
  expect(metadata.headers()["cache-control"]).toBe("no-store");
  const bearerOnly = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${rateToken}` },
  });
  expect((await bearerOnly.request.get("/api/developer-tokens")).status()).toBe(401);
  await bearerOnly.close();
  const sandbox = await browser.newContext({ baseURL });
  await session(users[2]!, sandbox);
  expect((await sandbox.request.get("/api/developer-tokens")).status()).toBe(403);
  await sandbox.close();
  await page.reload();
  await expect(page.getByRole("button", { name: "Generate token" })).toBeVisible();
  for (const width of [1440, 393]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () =>
      (
        await (window as typeof window & { axe: typeof axe }).axe.run(
          document.querySelector('form[aria-label="Create developer token"]')!,
        )
      ).violations.map((v) => ({ id: v.id, impact: v.impact })),
    );
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  // Create once at mobile size, then exercise the browser pagehide listener.
  await page.getByLabel("Label (optional)").fill("Pagehide verification");
  await page.getByRole("checkbox", { name: /Verification 0/ }).check();
  await page.getByRole("button", { name: "Generate token" }).click();
  await expect(page.getByTestId("developer-token-reveal")).toBeFocused();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByTestId("developer-token-reveal")).toHaveCount(0);
  const redis = new Redis(process.env.REDIS_URL!);
  try {
    const records = (await redis.zrange("telemetry:api-requests:v1", 0, -1)).map(
      (entry) =>
        JSON.parse(entry) as { developerApiTokenId?: string; callerType?: string; status: number },
    );
    const own = records.filter((record) => record.developerApiTokenId === tokenRow.id);
    expect(
      own.some((record) => record.callerType === "developer_token" && record.status === 200),
    ).toBe(true);
    expect(own.some((record) => record.status === 403)).toBe(true);
    const serialized = JSON.stringify(own);
    for (const sensitive of [token, tokenRow.tokenHash, "synthetic-private-webhook-marker"])
      expect(serialized.includes(sensitive)).toBe(false);
  } finally {
    await redis.quit();
  }
  expect(messages.some((m) => m.includes(token) || m.includes(tokenRow.tokenHash))).toBe(false);
  const evidence = {
    checkedAt: new Date().toISOString(),
    appRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeClean:
      execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "",
    node: process.version,
    chromium: browser.version(),
    sdk: {
      name: "@paiflow/sdk",
      version: "0.1.0",
      sha256: createHash("sha256")
        .update(readFileSync("/tmp/paiflow-dev-token-verify/paiflow-sdk-0.1.0.tgz"))
        .digest("hex"),
    },
    environment: "local, loopback only, testnet configuration; no chain requests",
    viewports: [1440, 393],
    primaryButton: { ...colors, contrastRatio: (l[0]! + 0.05) / (l[1]! + 0.05) },
    results: {
      browserHttpPackedSdk: "passed",
      operateRoutesRefusedReadOnly: operations.length,
      sharedCapabilitiesAllowance: 60,
      axeFormViolationsDesktopAndMobile: 0,
      clipboard: "injected callback verified; system clipboard unverified",
      telemetry:
        "browser console and Redis request records checked without credential/hash/webhook leakage",
    },
  };
  const evidencePath = test.info().outputPath("verification-summary.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  await test.info().attach("sanitized-verification-summary", {
    path: evidencePath,
    contentType: "application/json",
  });
  await context.close();
  await db.$disconnect();
});
