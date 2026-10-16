import { randomUUID } from "node:crypto";
import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { NextRequest, NextResponse } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  queue: vi.fn(async (_record: unknown) => true),
  work: vi.fn(async (_id: string, _route: string, fn: () => Promise<Response>) => fn()),
}));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/api/request-history/delivery", () => ({
  queueApiRequest: mocks.queue,
  apiRequestHealth: async () => ({}),
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: async () => {},
  withDeploymentWork: mocks.work,
}));
import { db } from "@/lib/db";
import { hashApiToken } from "@/lib/auth/api-token";
import { requireDeploymentToken, signedTokenAttribution } from "@/lib/api/v1/auth";
import { v1Route } from "@/lib/api/v1/handler";
import { assertApiPermission, V1_PERMISSIONS, type V1Operation } from "@/lib/api/v1/permissions";
import { GET as discovery } from "@/app/api/v1/deployments/route";
import { markTokenKnown } from "@/lib/api/v1/pre-auth";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { signerFromTransaction } from "@/lib/stellar/signer";
import { apiRequestReport } from "@/lib/api/request-history/report";
import { API_HISTORY_VERSION } from "@/lib/api/request-history/schema";

const users: string[] = [],
  flows: string[] = [],
  deployments: string[] = [],
  tokens: string[] = [],
  hashes: string[] = [];
const version = `dt-${randomUUID()}`;
let owner: string, other: string;
const req = (raw: string, id?: string, method = "GET", suffix = "events") =>
  new NextRequest(`https://app.test/api/v1/deployments${id ? `/${id}/${suffix}` : ""}`, {
    method,
    headers: { authorization: `Bearer ${raw}`, "x-forwarded-for": "198.51.100.103" },
  });
async function issue(permission: "READ_ONLY" | "READ_OPERATE" = "READ_OPERATE") {
  const raw = `pfd_${randomUUID().replaceAll("-", "").repeat(2)}`;
  const row = await db.developerApiToken.create({
    data: {
      ownerId: owner,
      tokenHash: hashApiToken(raw),
      tokenPrefix: raw.slice(0, 12),
      permission,
      grants: { create: deployments.slice(0, 2).map((deploymentId) => ({ deploymentId })) },
    },
  });
  tokens.push(row.id);
  await markTokenKnown(row.tokenHash, null);
  return { raw, row };
}
beforeAll(async () => {
  for (let n = 0; n < 2; n++)
    users.push(
      (
        await db.user.create({
          data: {
            username: `${version}-${n}`,
            passwordHash: "synthetic",
            analyticsAudience: "EXTERNAL",
          },
        })
      ).id,
    );
  [owner, other] = users as [string, string];
  for (let n = 0; n < 4; n++) {
    const ownerId = n === 3 ? other : owner;
    const flow = await db.flow.create({
      data: {
        ownerId,
        name: `Token flow ${n}`,
        templateKind: "DEPOSIT_TRIGGER",
        graph: {},
        parameters: {},
      },
    });
    flows.push(flow.id);
    deployments.push(
      (
        await db.deployment.create({
          data: {
            ownerId,
            flowId: flow.id,
            status: "CONFIRMED",
            network: "testnet",
            graphSnapshot: {},
            paramsSnapshot: {},
          },
        })
      ).id,
    );
  }
});
afterAll(async () => {
  await db.apiRequestLog.deleteMany({ where: { appVersion: version } });
  await db.analyticsDelivery.deleteMany({
    where: { OR: hashes.map((hash) => ({ properties: { path: ["tx_hash"], equals: hash } })) },
  });
  await db.signedTransaction.deleteMany({ where: { txHash: { in: hashes } } });
  await db.developerTokenGrant.deleteMany({ where: { tokenId: { in: tokens } } });
  await db.developerApiToken.deleteMany({ where: { id: { in: tokens } } });
  await db.deploymentApiToken.deleteMany({ where: { deploymentId: { in: deployments } } });
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  await db.flow.deleteMany({ where: { id: { in: flows } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("selected-deployment developer credentials", () => {
  it("authorizes two selections and refuses unselected/foreign deployments identically", async () => {
    const { raw, row } = await issue();
    for (const id of deployments.slice(0, 2)) {
      const auth = await requireDeploymentToken(req(raw, id), id);
      expect(auth).toMatchObject({
        tokenType: "developer_token",
        ownerId: owner,
        deployment: { id },
      });
      expect(auth.token).not.toHaveProperty("tokenHash");
    }
    for (const id of deployments.slice(2))
      await expect(requireDeploymentToken(req(raw, id), id)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
        message: "A valid API token for this deployment is required",
      });
    // A stale grant does not override current ownership.
    await db.deployment.update({ where: { id: deployments[0]! }, data: { ownerId: other } });
    await expect(
      requireDeploymentToken(req(raw, deployments[0]), deployments[0]!),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await db.deployment.update({ where: { id: deployments[0]! }, data: { ownerId: owner } });
    expect(
      (await db.developerApiToken.findUniqueOrThrow({ where: { id: row.id } })).lastUsedAt,
    ).not.toBeNull();
  });
  it("enforces every operation and refuses undeclared operations before domain work", async () => {
    const { raw } = await issue("READ_ONLY");
    const auth = await requireDeploymentToken(req(raw, deployments[0]), deployments[0]!);
    for (const [operation, permission] of Object.entries(V1_PERMISSIONS)) {
      if (permission === "read")
        expect(() => assertApiPermission(auth, operation as V1Operation)).not.toThrow();
      else expect(() => assertApiPermission(auth, operation as V1Operation)).toThrow("read-only");
    }
    expect(() => assertApiPermission(auth, "GET missing" as V1Operation)).toThrow(
      "no declared permission",
    );
    const domain = vi.fn(async () => NextResponse.json({ data: {} }));
    for (const operation of [
      "POST funding",
      "POST funding/submit",
      "POST funding/reconcile",
      "POST release-early",
    ] as const) {
      const route = v1Route({ operation, rateLimit: { limit: 60, windowSeconds: 60 } }, domain);
      expect(
        (
          await route(req(raw, deployments[0], "POST"), {
            params: Promise.resolve({ id: deployments[0]! }),
          })
        ).status,
      ).toBe(403);
    }
    expect(domain).not.toHaveBeenCalled();
    const operating = await issue("READ_OPERATE");
    const operatingAuth = await requireDeploymentToken(
      req(operating.raw, deployments[0]),
      deployments[0]!,
    );
    for (const operation of Object.keys(V1_PERMISSIONS))
      expect(() => assertApiPermission(operatingAuth, operation as V1Operation)).not.toThrow();
  });
  it("rechecks liveness, owner status and deployment service state even for known tokens", async () => {
    const { raw, row } = await issue();
    const id = deployments[0]!;
    for (const data of [{ revokedAt: new Date() }, { expiresAt: new Date(Date.now() - 1) }]) {
      await db.developerApiToken.update({ where: { id: row.id }, data });
      await expect(requireDeploymentToken(req(raw, id), id)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await db.developerApiToken.update({
        where: { id: row.id },
        data: { revokedAt: null, expiresAt: null },
      });
    }
    for (const data of [{ isActive: false }, { role: "SANDBOX" as const }]) {
      await db.user.update({ where: { id: owner }, data });
      await expect(requireDeploymentToken(req(raw, id), id)).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await db.user.update({ where: { id: owner }, data: { isActive: true, role: "USER" } });
    }
    const retiring = await db.deployment.create({
      data: {
        ownerId: owner,
        flowId: flows[0]!,
        network: "testnet",
        status: "CONFIRMED",
        graphSnapshot: {},
        paramsSnapshot: {},
      },
    });
    deployments.push(retiring.id);
    await db.developerTokenGrant.create({ data: { tokenId: row.id, deploymentId: retiring.id } });
    for (const serviceState of ["RETIRING", "RETIRED"] as const) {
      await db.deployment.update({
        where: { id: retiring.id },
        data: {
          serviceState,
          retirementRequestedAt: new Date(),
          ...(serviceState === "RETIRED"
            ? { retiredAt: new Date(), retirementReconciledAt: new Date() }
            : {}),
        },
      });
      await expect(
        requireDeploymentToken(req(raw, retiring.id), retiring.id),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });
  it("scope edits are immediate and one scope refusal cannot poison other selections", async () => {
    const { raw, row } = await issue();
    const id = deployments[2]!;
    const route = v1Route(
      { operation: "GET events", rateLimit: { limit: 100, windowSeconds: 60 } },
      async () => NextResponse.json({ data: {} }),
    );
    const call = (target: string) =>
      route(req(raw, target), { params: Promise.resolve({ id: target }) });
    expect((await call(id)).status).toBe(401);
    expect((await call(deployments[0]!)).status).toBe(200);
    await db.developerTokenGrant.create({ data: { tokenId: row.id, deploymentId: id } });
    expect((await call(id)).status).toBe(200);
    await db.developerTokenGrant.delete({
      where: { tokenId_deploymentId: { tokenId: row.id, deploymentId: id } },
    });
    expect((await call(id)).status).toBe(401);
    expect((await call(deployments[1]!)).status).toBe(200);
  });
  it("shares per-operation allowances across deployments and variable transaction hashes", async () => {
    const { raw } = await issue();
    const route = v1Route<{ id: string; txHash: string }>(
      { operation: "GET transactions/:txHash", rateLimit: { limit: 1, windowSeconds: 60 } },
      async () => NextResponse.json({ data: {} }),
    );
    const call = (id: string) => {
      const txHash = randomUUID();
      return route(req(raw, id, "GET", `transactions/${txHash}`), {
        params: Promise.resolve({ id, txHash }),
      });
    };
    expect((await call(deployments[0]!)).status).toBe(200);
    expect((await call(deployments[1]!)).status).toBe(429);
    expect(mocks.queue.mock.lastCall?.[0]).toMatchObject({
      developerApiTokenId: expect.any(String),
      apiTokenId: null,
      callerType: "developer_token",
      accountId: owner,
      deploymentId: deployments[1],
    });
  });
  it("limits authenticated permission and scope refusals in the same token bucket", async () => {
    const { raw } = await issue("READ_ONLY");
    const route = v1Route(
      { operation: "POST execute", rateLimit: { limit: 1, windowSeconds: 60 } },
      async () => NextResponse.json({ data: {} }),
    );
    const call = (id: string) => route(req(raw, id, "POST"), { params: Promise.resolve({ id }) });
    expect((await call(deployments[0]!)).status).toBe(403);
    expect((await call(deployments[1]!)).status).toBe(429);
    const second = await issue();
    const scopeRoute = v1Route(
      { operation: "GET capabilities", rateLimit: { limit: 1, windowSeconds: 60 } },
      async () => NextResponse.json({ data: {} }),
    );
    const scopeCall = (id: string) =>
      scopeRoute(req(second.raw, id), { params: Promise.resolve({ id }) });
    expect((await scopeCall(deployments[2]!)).status).toBe(401);
    expect((await scopeCall(deployments[0]!)).status).toBe(429);
  });
  it("discovers only grants with bounded pagination and supports legacy single-deployment tokens", async () => {
    const { raw } = await issue("READ_ONLY");
    const call = (raw: string, query = "") =>
      discovery(new NextRequest(req(raw).url + query, { headers: req(raw).headers }), {
        // Static Next route contexts have no params member.
        // Dynamic route fixtures above still supply their required ID.
      });
    const first = await (await call(raw, "?limit=1")).json();
    const second = await (await call(raw, `?limit=1&cursor=${first.data.nextCursor}`)).json();
    expect([first.data.items[0].id, second.data.items[0].id].sort()).toEqual(
      deployments.slice(0, 2).sort(),
    );
    expect(Object.keys(first.data.items[0]).sort()).toEqual(["flowName", "id", "network"]);
    expect((await call(raw, "?limit=101")).status).toBe(422);
    expect((await call(raw, "?cursor=bad")).status).toBe(422);
    const legacy = `pfk_${"19".repeat(32)}`;
    await db.deploymentApiToken.create({
      data: {
        deploymentId: deployments[0]!,
        tokenHash: hashApiToken(legacy),
        tokenPrefix: legacy.slice(0, 12),
        createdById: owner,
      },
    });
    expect((await (await call(legacy)).json()).data.items.map((x: { id: string }) => x.id)).toEqual(
      [deployments[0]],
    );
    expect(
      (await requireDeploymentToken(req(legacy, deployments[0]), deployments[0]!)).tokenType,
    ).toBe("deployment_token");
    await expect(
      requireDeploymentToken(req(`pkdev_${"19".repeat(32)}`, deployments[0]), deployments[0]!),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("retains separate signer/caller attribution and prevents cross-deployment hash replay", async () => {
    const { row } = await issue();
    const wallet = Keypair.random();
    const tx = new TransactionBuilder(new Account(wallet.publicKey(), "0"), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
      .setTimeout(30)
      .build();
    tx.sign(wallet);
    const signer = signerFromTransaction(tx);
    if (!signer.ok) throw new Error("invalid fixture");
    hashes.push(signer.txHash);
    const input = {
      signer,
      kind: "API_EXECUTE" as const,
      network: "testnet",
      deploymentId: deployments[0]!,
      ...signedTokenAttribution({ tokenId: row.id, tokenType: "developer_token" }),
    };
    await recordSignedTransaction(input);
    await recordSignedTransaction(input);
    expect(
      await db.signedTransaction.findUniqueOrThrow({ where: { txHash: signer.txHash } }),
    ).toMatchObject({
      userId: null,
      callerAccountId: owner,
      developerApiTokenId: row.id,
      apiTokenId: null,
      signerAddress: wallet.publicKey(),
      audience: "EXTERNAL",
    });
    await expect(
      recordSignedTransaction({ ...input, deploymentId: deployments[1]! }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db.developerApiToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await db.developerTokenGrant.deleteMany({ where: { tokenId: row.id } });
    expect(
      await db.signedTransaction.count({
        where: { txHash: signer.txHash, developerApiTokenId: row.id },
      }),
    ).toBe(1);
    // Exercise the report SQL with a developer preparation, failed response and recovery.
    const now = Date.now();
    await db.analyticsPolicy.upsert({
      where: { version: API_HISTORY_VERSION },
      create: { version: API_HISTORY_VERSION, activatedAt: new Date(now - 120000) },
      update: { activatedAt: new Date(now - 120000) },
    });
    await db.signedTransaction.update({
      where: { txHash: signer.txHash },
      data: { outcome: "CONFIRMED", confirmedAt: new Date() },
    });
    const prep = randomUUID();
    const common = {
      requestId: randomUUID(),
      accountId: owner,
      tokenCreatorId: owner,
      apiTokenId: null,
      developerApiTokenId: row.id,
      deploymentId: deployments[0]!,
      callerType: "developer_token",
      method: "POST",
      durationMs: 10,
      network: "testnet",
      environment: version,
      appVersion: version,
      audience: "EXTERNAL" as const,
      trackingVersion: API_HISTORY_VERSION,
    };
    await db.apiRequestLog.createMany({
      data: [
        {
          ...common,
          id: prep,
          occurredAt: new Date(now - 3000),
          endpoint: "/api/v1/deployments/:id/execute",
          status: 200,
        },
        {
          ...common,
          id: randomUUID(),
          occurredAt: new Date(now - 2000),
          endpoint: "/api/v1/deployments/:id/execute/submit",
          status: 502,
          txHash: signer.txHash,
          preparationRequestId: prep,
        },
        {
          ...common,
          id: randomUUID(),
          occurredAt: new Date(now - 1000),
          endpoint: "/api/v1/deployments/:id/execute/submit",
          status: 200,
          txHash: signer.txHash,
          preparationRequestId: prep,
        },
      ],
    });
    const report = await apiRequestReport({
      start: new Date(now - 60000).toISOString(),
      end: new Date(now + 1000).toISOString(),
      network: "testnet",
      environment: version,
      audience: "EXTERNAL",
    });
    expect(report.activation).toEqual([
      expect.objectContaining({ calling_tokens: "1", tokens_with_confirmed_transactions: "1" }),
    ]);
    expect(report.preparation).toEqual([
      expect.objectContaining({ preparations: "1", explicitly_linked_submissions: "1" }),
    ]);
    expect(report.recovery).toEqual([
      expect.objectContaining({ failed_submit_requests: "1", recovered_same_hash_within_24h: "1" }),
    ]);
  });
});
