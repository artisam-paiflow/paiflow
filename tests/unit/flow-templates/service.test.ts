import { randomUUID } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { db as realDb } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
import { flowToPipeline } from "@/lib/flows/to-params";
import { contentHash } from "@/lib/flow-templates/artifacts";
import {
  createFlowTemplate,
  updateFlowTemplate,
  publishFlowTemplate,
  retireFlowTemplate,
  getFlowTemplate,
  getFlowTemplateVersion,
  listFlowTemplates,
  listFlowTemplateVersions,
  resolveTemplateForPreparation,
  lockAndResolveTemplateForPreparation,
} from "@/lib/flow-templates/service";
import { GET, POST } from "@/app/api/flow-templates/route";
import { PATCH, GET as inspect } from "@/app/api/flow-templates/[id]/route";
import { POST as publish, GET as versions } from "@/app/api/flow-templates/[id]/versions/route";
import { GET as inspectVersion } from "@/app/api/flow-templates/[id]/versions/[versionId]/route";
import { POST as preview } from "@/app/api/flow-templates/[id]/versions/[versionId]/bindings/route";
import { POST as retire } from "@/app/api/flow-templates/[id]/retire/route";
import { POST as retireVersion } from "@/app/api/flow-templates/[id]/versions/[versionId]/retire/route";

const state = vi.hoisted(() => ({
  tx: null as unknown as import("@prisma/client").Prisma.TransactionClient,
  session: vi.fn(),
  rate: vi.fn(),
}));
// Every real PostgreSQL test rolls back its fixture AND immutable version rows.
// Services use the same transaction; no immutability safeguard is bypassed.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "$transaction")
          return (fn: (tx: typeof state.tx) => Promise<unknown>) => fn(state.tx);
        const value = Reflect.get(state.tx, key);
        return typeof value === "function" ? value.bind(state.tx) : value;
      },
    },
  ),
}));
vi.mock("@/lib/auth", () => ({ requireSession: state.session }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: state.rate, clientIp: () => "127.0.0.1" }));
const payer = Keypair.random().publicKey();
const receiver = Keypair.random().publicKey();
const factory = StrKey.encodeContract(Buffer.alloc(32, 4));
const definition = {
  schemaVersion: 1 as const,
  graph: FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "p",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: receiver,
          mode: "fixed",
          amountStroops: "100",
          fullAmount: false,
        },
      },
    ],
    edges: [{ id: "e", source: "t", target: "p" }],
  }),
  inputs: [
    {
      inputId: "recipient",
      label: "Recipient",
      target: { nodeId: "p", field: "recipient" as const },
      type: "wallet" as const,
    },
  ],
};
const request = (method = "GET", body?: unknown, query = "") =>
  new NextRequest(`http://localhost/api/flow-templates${query}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const versionContext = (id: string, versionId: string) => ({
  params: Promise.resolve({ id, versionId }),
});
const rollback = new Error("test-only rollback");
async function scratch(
  fn: (tx: Prisma.TransactionClient, ownerId: string, otherId: string) => Promise<void>,
) {
  await realDb
    .$transaction(
      async (tx) => {
        state.tx = tx;
        state.session.mockReset();
        state.rate.mockReset();
        const owner = await tx.user.create({ data: { username: `templates-${randomUUID()}` } });
        const other = await tx.user.create({ data: { username: `templates-${randomUUID()}` } });
        state.session.mockResolvedValue({ id: owner.id, role: "USER" });
        for (const kind of ["DEPOSIT_TRIGGER", "PAYER"] as const)
          await tx.contractTemplate.upsert({
            where: { kind_network: { kind, network: "testnet" } },
            create: { kind, network: "testnet", wasmHash: "a".repeat(64), abiJson: {} },
            update: { wasmHash: "a".repeat(64), abiJson: {} },
          });
        await tx.factoryDeployment.upsert({
          where: { network: "testnet" },
          create: { network: "testnet", address: factory, wasmHash: "b".repeat(64) },
          update: { address: factory, wasmHash: "b".repeat(64) },
        });
        await fn(tx, owner.id, other.id);
        throw rollback;
      },
      { timeout: 20000 },
    )
    .catch((error) => {
      if (error !== rollback) throw error;
    });
}
async function fixture(ownerId: string) {
  const template = await createFlowTemplate(
    ownerId,
    { name: "Agreement", definition },
    request("POST"),
  );
  const version = await publishFlowTemplate(
    ownerId,
    template.id,
    { expectedRevision: 1 },
    request("POST"),
  );
  const bindings = {
    version: 1,
    templateVersionId: version.id,
    values: [{ inputId: "recipient", value: { type: "wallet", value: payer } }],
  };
  return { template, version, bindings };
}

describe("private template owner API and PostgreSQL persistence", () => {
  it("saves, publishes, resolves typed bindings and audits without creating any deployment", () =>
    scratch(async (tx, owner) => {
      const created = await POST(request("POST", { name: "Agreement", definition }));
      expect(created.status).toBe(201);
      expect(created.headers.get("cache-control")).toBe("no-store");
      const template = (await created.json()).data;
      const published = await publish(
        request("POST", { expectedRevision: 1 }),
        context(template.id),
      );
      expect(published.status).toBe(201);
      const version = (await published.json()).data;
      const bound = await preview(
        request("POST", {
          version: 1,
          templateVersionId: version.id,
          values: [{ inputId: "recipient", value: { type: "wallet", value: payer } }],
        }),
        versionContext(template.id, version.id),
      );
      expect(bound.status).toBe(200);
      expect((await bound.json()).data.graph.nodes[1].config.recipient).toBe(payer);
      expect(await tx.deployment.count({ where: { ownerId: owner } })).toBe(0);
      const saved = await getFlowTemplateVersion(owner, template.id, version.id);
      expect(saved.definition).toEqual(definition);
      expect(saved.artifacts).toMatchObject({
        factoryAddress: factory,
        compilerAbi: 1,
        nodes: [
          { templateKind: "DEPOSIT_TRIGGER", wasmHash: "a".repeat(64), abiHash: contentHash({}) },
          { templateKind: "PAYER", wasmHash: "a".repeat(64) },
        ],
      });
      expect(
        (await tx.auditLog.findMany({ where: { userId: owner } })).map((row) => row.action).sort(),
      ).toEqual(["FLOW_TEMPLATE_CREATE", "FLOW_TEMPLATE_PUBLISH"]);
    }));
  it.each(["Pay", "Split"])("refuses publication of a legacy Receive → %s minimum", (kind) =>
    scratch(async (tx, owner) => {
      const unsupported = {
        ...structuredClone(definition),
        inputs: [
          {
            inputId: "minimum",
            label: "Minimum deposit",
            target: { nodeId: "t", field: "minAmountStroops" as const },
            type: "stroops" as const,
          },
        ],
      };
      const root = unsupported.graph.nodes[0]!;
      if (root.type === "on_receive") root.config.minAmountStroops = "100";
      if (kind === "Split")
        unsupported.graph.nodes[1] = FlowGraphSchema.parse({
          nodes: [
            {
              id: "p",
              type: "split",
              config: {
                asset: { kind: "native" },
                recipients: [{ address: receiver, mode: "percentage", bps: 10000 }],
              },
            },
          ],
          edges: [],
        }).nodes[0]!;
      const template = await createFlowTemplate(
        owner,
        { name: "ignored legacy minimum", definition: unsupported },
        request("POST"),
      );
      const response = await publish(
        request("POST", { expectedRevision: 1 }),
        context(template.id),
      );
      expect(response.status).toBe(422);
      expect((await response.json()).error.message).toMatch(/minimum is not enforced/);
      expect(await tx.flowTemplateVersion.count({ where: { templateId: template.id } })).toBe(0);
    }),
  );
  it("requires reviewed execution artifacts for a policy-aware root minimum", () =>
    scratch(async (tx, owner) => {
      const policyDefinition = {
        ...structuredClone(definition),
        inputs: [
          {
            inputId: "minimum",
            label: "Minimum deposit",
            target: { nodeId: "t", field: "minAmountStroops" as const },
            type: "stroops" as const,
          },
        ],
      };
      policyDefinition.graph.fieldPolicies = { version: 1, nodes: [] };
      const root = policyDefinition.graph.nodes[0]!;
      if (root.type === "on_receive") root.config.minAmountStroops = "100";
      const template = await createFlowTemplate(
        owner,
        { name: "enforced minimum", definition: policyDefinition },
        request("POST"),
      );
      await expect(
        publishFlowTemplate(owner, template.id, { expectedRevision: 1 }, request("POST")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      for (const kind of ["DEPOSIT_TRIGGER", "PAYER"] as const)
        await tx.contractTemplate.update({
          where: { kind_network: { kind, network: "testnet" } },
          data: { wasmHash: EXECUTION_V1_WASM_HASHES[kind] },
        });
      const version = await publishFlowTemplate(
        owner,
        template.id,
        { expectedRevision: 1 },
        request("POST"),
      );
      const values = {
        version: 1,
        templateVersionId: version.id,
        values: [{ inputId: "minimum", value: { type: "stroops", value: "200" } }],
      };
      const resolved = await resolveTemplateForPreparation(owner, template.id, version.id, values);
      expect(
        flowToPipeline(resolved.graph, undefined, { forValidation: true })[0]!.params,
      ).toMatchObject({ kind: "deposit_trigger", executionNodeId: "t", minAmountStroops: "200" });
      expect(resolved.artifacts.nodes[0]).toMatchObject({
        wasmHash: EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
        policyVersion: 1,
      });
      await tx.contractTemplate.update({
        where: { kind_network: { kind: "DEPOSIT_TRIGGER", network: "testnet" } },
        data: { wasmHash: "a".repeat(64) },
      });
      await expect(
        resolveTemplateForPreparation(owner, template.id, version.id, values),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }));
  it("preserves old versions after edits and publishes increasing immutable versions", () =>
    scratch(async (_tx, owner) => {
      const { template, version } = await fixture(owner);
      const changed = structuredClone(definition);
      const p = changed.graph.nodes[1]!;
      if (p.type === "pay") p.config.amountStroops = "200";
      await updateFlowTemplate(
        owner,
        template.id,
        { expectedRevision: 1, definition: changed },
        request("PATCH"),
      );
      await expect(
        publishFlowTemplate(owner, template.id, { expectedRevision: 1 }, request("POST")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const second = await publishFlowTemplate(
        owner,
        template.id,
        { expectedRevision: 2 },
        request("POST"),
      );
      expect(second.version).toBe(2);
      expect(second.contentHash).not.toBe(version.contentHash);
      expect((await getFlowTemplateVersion(owner, template.id, version.id)).definition).toEqual(
        definition,
      );
      expect((await listFlowTemplateVersions(owner, template.id, { limit: 1 })).items[0]!.id).toBe(
        second.id,
      );
    }));
  it("fails closed on changed WASM/ABI/factory evidence without overwriting the published snapshot", () =>
    scratch(async (tx, owner) => {
      const { template, version, bindings } = await fixture(owner);
      await tx.contractTemplate.update({
        where: { kind_network: { kind: "PAYER", network: "testnet" } },
        data: { abiJson: { changed: true } },
      });
      await expect(
        resolveTemplateForPreparation(owner, template.id, version.id, bindings),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await getFlowTemplateVersion(owner, template.id, version.id)).contentHash).toBe(
        version.contentHash,
      );
      await tx.contractTemplate.update({
        where: { kind_network: { kind: "PAYER", network: "testnet" } },
        data: { abiJson: {}, wasmHash: "c".repeat(64) },
      });
      await expect(
        resolveTemplateForPreparation(owner, template.id, version.id, bindings),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await tx.contractTemplate.update({
        where: { kind_network: { kind: "PAYER", network: "testnet" } },
        data: { wasmHash: "a".repeat(64) },
      });
      await tx.factoryDeployment.update({
        where: { network: "testnet" },
        data: { address: StrKey.encodeContract(Buffer.alloc(32, 5)) },
      });
      await expect(
        resolveTemplateForPreparation(owner, template.id, version.id, bindings),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }));
  it("rejects publication without synchronized factory/artifact evidence and rejects expired cutoff", () =>
    scratch(async (tx, owner) => {
      const template = await createFlowTemplate(owner, { name: "t", definition }, request("POST"));
      await tx.factoryDeployment.update({
        where: { network: "testnet" },
        data: { wasmHash: null },
      });
      await expect(
        publishFlowTemplate(owner, template.id, { expectedRevision: 1 }, request("POST")),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await tx.flowTemplateVersion.count({ where: { templateId: template.id } })).toBe(0);
      await expect(
        publishFlowTemplate(
          owner,
          template.id,
          { expectedRevision: 1, expiresAt: "2000-01-01T00:00:00Z" },
          request("POST"),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }));
  it("admits fresh bound schedule deadlines after the published exemplar expires", () =>
    scratch(async (tx, owner) => {
      const scheduled = structuredClone(definition);
      scheduled.graph.nodes[0] = FlowGraphSchema.parse({
        nodes: [
          {
            id: "t",
            type: "on_schedule",
            config: {
              intervalAmount: 1,
              intervalUnit: "day",
              startsAt: "2030-01-01T00:00:00Z",
              endsAt: "2030-06-01T00:00:00Z",
            },
          },
        ],
        edges: [],
      }).nodes[0]!;
      const complete = {
        ...scheduled,
        inputs: [
          {
            inputId: "end",
            label: "Agreement end",
            target: { nodeId: "t", field: "endsAt" as const },
            type: "timestamp" as const,
          },
        ],
      };
      await tx.contractTemplate.upsert({
        where: { kind_network: { kind: "STREAMER", network: "testnet" } },
        create: { kind: "STREAMER", network: "testnet", wasmHash: "d".repeat(64), abiJson: {} },
        update: { wasmHash: "d".repeat(64), abiJson: {} },
      });
      const template = await createFlowTemplate(
        owner,
        { name: "scheduled", definition: complete },
        request("POST"),
      );
      const version = await publishFlowTemplate(
        owner,
        template.id,
        { expectedRevision: 1 },
        request("POST"),
      );
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
      try {
        const resolved = await resolveTemplateForPreparation(owner, template.id, version.id, {
          version: 1,
          templateVersionId: version.id,
          values: [{ inputId: "end", value: { type: "timestamp", value: "2032-01-01T00:00:00Z" } }],
        });
        expect(resolved.graph.nodes[0]).toMatchObject({
          config: { endsAt: "2032-01-01T00:00:00Z" },
        });
        expect(resolved.version.contentHash).toBe(version.contentHash);
        expect(resolved.artifacts.nodes[0]!.templateKind).toBe("STREAMER");
      } finally {
        clock.mockRestore();
      }
    }));
  it("retirement prevents new preparations and preserves readable version evidence", () =>
    scratch(async (tx, owner) => {
      const { template, version, bindings } = await fixture(owner);
      const original = await resolveTemplateForPreparation(
        owner,
        template.id,
        version.id,
        bindings,
      );
      expect(
        (
          await retireVersion(
            request("POST", { confirm: "retire" }),
            versionContext(template.id, version.id),
          )
        ).status,
      ).toBe(200);
      await expect(
        resolveTemplateForPreparation(owner, template.id, version.id, bindings),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await getFlowTemplateVersion(owner, template.id, version.id)).contentHash).toBe(
        original.version.contentHash,
      );
      expect(
        (await inspectVersion(request(), versionContext(template.id, version.id))).status,
      ).toBe(200);
      expect(
        (await retire(request("POST", { confirm: "retire" }), context(template.id))).status,
      ).toBe(200);
      expect(
        (await retire(request("POST", { confirm: "retire" }), context(template.id))).status,
      ).toBe(200);
      await expect(
        updateFlowTemplate(
          owner,
          template.id,
          { expectedRevision: 1, name: "new" },
          request("PATCH"),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await tx.auditLog.findMany({ where: { userId: owner, action: "FLOW_TEMPLATE_RETIRE" } }),
      ).toHaveLength(1);
    }));
  it("explicit version expiry refuses new binding admissions without deleting the version", () =>
    scratch(async (tx, owner) => {
      const template = await createFlowTemplate(owner, { name: "t", definition }, request("POST"));
      const version = await publishFlowTemplate(
        owner,
        template.id,
        { expectedRevision: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() },
        request("POST"),
      );
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200000);
      try {
        await expect(
          resolveTemplateForPreparation(owner, template.id, version.id, {
            version: 1,
            templateVersionId: version.id,
            values: [],
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        clock.mockRestore();
      }
      expect(await tx.flowTemplateVersion.findUnique({ where: { id: version.id } })).not.toBeNull();
    }));
  it("hides every foreign-owner detail/write/version/binding/cursor", () =>
    scratch(async (_tx, owner, other) => {
      const { template, version, bindings } = await fixture(owner);
      state.session.mockResolvedValue({ id: other, role: "USER" });
      expect((await inspect(request(), context(template.id))).status).toBe(404);
      expect(
        (
          await PATCH(
            request("PATCH", { expectedRevision: 1, name: "stolen" }),
            context(template.id),
          )
        ).status,
      ).toBe(404);
      expect(
        (await publish(request("POST", { expectedRevision: 1 }), context(template.id))).status,
      ).toBe(404);
      expect((await versions(request(), context(template.id))).status).toBe(404);
      expect(
        (await inspectVersion(request(), versionContext(template.id, version.id))).status,
      ).toBe(404);
      expect(
        (await preview(request("POST", bindings), versionContext(template.id, version.id))).status,
      ).toBe(404);
      expect(
        (await retire(request("POST", { confirm: "retire" }), context(template.id))).status,
      ).toBe(404);
      expect(
        (
          await retireVersion(
            request("POST", { confirm: "retire" }),
            versionContext(template.id, version.id),
          )
        ).status,
      ).toBe(404);
      expect((await GET(request("GET", undefined, `?cursor=${template.id}`))).status).toBe(404);
      expect((await GET(request())).status).toBe(200);
      expect((await (await GET(request())).json()).data.items).toEqual([]);
      await expect(getFlowTemplate(other, template.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }));
  it("rejects sandbox and bearer-only requests and applies rate limits before writes", () =>
    scratch(async (_tx, owner) => {
      state.session.mockResolvedValue({ id: owner, role: "SANDBOX" });
      expect((await GET(request())).status).toBe(403);
      expect((await POST(request("POST", { name: "t", definition }))).status).toBe(403);
      state.session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Sign in"));
      expect((await POST(request("POST", { name: "t", definition }))).status).toBe(401);
      state.session.mockResolvedValue({ id: owner, role: "USER" });
      state.rate.mockRejectedValue(new AppError("RATE_LIMITED", "Too many writes"));
      expect((await POST(request("POST", { name: "t", definition }))).status).toBe(429);
      expect(state.rate).toHaveBeenCalledWith({
        key: `flow-templates:write:${owner}`,
        limit: 30,
        windowSeconds: 60,
      });
      expect(await state.tx.flowTemplate.count({ where: { ownerId: owner } })).toBe(0);
    }));
  it("validates strict request bodies, UUIDs, duplicate queries and stale draft revisions", () =>
    scratch(async (_tx, owner) => {
      expect(
        (await POST(request("POST", { name: "t", definition, ownerId: randomUUID() }))).status,
      ).toBe(422);
      expect((await GET(request("GET", undefined, "?limit=1&limit=2"))).status).toBe(422);
      expect((await GET(request("GET", undefined, "?public=true"))).status).toBe(422);
      expect((await inspect(request(), context("invalid"))).status).toBe(404);
      const { template } = await fixture(owner);
      expect(
        (await PATCH(request("PATCH", { expectedRevision: 99, name: "new" }), context(template.id)))
          .status,
      ).toBe(409);
      expect((await retire(request("POST", { confirm: true }), context(template.id))).status).toBe(
        422,
      );
      expect(
        (
          await publish(
            request("POST", { expectedRevision: 1, network: "mainnet" }),
            context(template.id),
          )
        ).status,
      ).toBe(422);
    }));
  it("uses stable scoped keyset pagination without leaking graph/artifacts in lists", () =>
    scratch(async (tx, owner) => {
      const first = await createFlowTemplate(owner, { name: "first", definition }, request("POST"));
      const second = await createFlowTemplate(
        owner,
        { name: "second", definition },
        request("POST"),
      );
      const page = await listFlowTemplates(owner, { limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).not.toBeNull();
      const next = await listFlowTemplates(owner, { limit: 1, cursor: page.nextCursor! });
      expect(next.items).toHaveLength(1);
      expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
      expect(next.nextCursor).toBeNull();
      expect(page.items[0]).not.toHaveProperty("draft");
      expect(new Set([page.items[0]!.id, next.items[0]!.id])).toEqual(
        new Set([first.id, second.id]),
      );
      const version = await publishFlowTemplate(
        owner,
        first.id,
        { expectedRevision: 1 },
        request("POST"),
      );
      await publishFlowTemplate(owner, first.id, { expectedRevision: 1 }, request("POST"));
      const p = await listFlowTemplateVersions(owner, first.id, { limit: 1 });
      const n = await listFlowTemplateVersions(owner, first.id, {
        limit: 1,
        cursor: p.nextCursor!,
      });
      expect(n.items[0]!.id).not.toBe(p.items[0]!.id);
      expect(n.nextCursor).toBeNull();
      expect(p.items[0]).not.toHaveProperty("definition");
      expect(await tx.flowTemplateVersion.count({ where: { templateId: first.id } })).toBe(2);
      expect(version.version).toBe(1);
    }));
  it.each(["definition", "artifacts", "network", "contentHash", "expiresAt"])(
    "database rejects published %s rewrites",
    (field) =>
      scratch(async (tx, owner) => {
        const { version } = await fixture(owner);
        const changes: Record<string, unknown> = {
          definition: {},
          artifacts: {},
          network: "mainnet",
          contentHash: "c".repeat(64),
          expiresAt: new Date("2035-01-01T00:00:00Z"),
        };
        await expect(
          tx.flowTemplateVersion.update({
            where: { id: version.id },
            data: { [field]: changes[field] },
          }),
        ).rejects.toThrow(/immutable/);
      }),
  );
  it("database refuses deletion of published evidence", () =>
    scratch(async (tx, owner) => {
      const { version } = await fixture(owner);
      await expect(tx.flowTemplateVersion.delete({ where: { id: version.id } })).rejects.toThrow(
        /cannot be deleted/,
      );
    }));
  it("database refuses reversing version retirement", () =>
    scratch(async (tx, owner) => {
      const { template, version } = await fixture(owner);
      await retireFlowTemplate(owner, template.id, request("POST"), version.id);
      await expect(
        tx.flowTemplateVersion.update({ where: { id: version.id }, data: { retiredAt: null } }),
      ).rejects.toThrow(/irreversible/);
    }));
  it("serializes retirement with the caller's template admission transaction", async () => {
    // Draft-only fixture: no immutable evidence is deleted by cleanup. A failed
    // version lookup still holds the shared gate until its caller ends the tx.
    const owner = await realDb.user.create({ data: { username: `template-lock-${randomUUID()}` } });
    const template = await realDb.flowTemplate.create({
      data: { ownerId: owner.id, name: "lock", draft: definition },
    });
    let unlock!: () => void;
    let locked!: () => void;
    let writerReady!: (pid: number) => void;
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writerPid = new Promise<number>((resolve) => {
      writerReady = resolve;
    });
    const reader = realDb.$transaction(
      async (tx) => {
        await expect(
          lockAndResolveTemplateForPreparation(tx, owner.id, template.id, randomUUID(), {}),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        locked();
        await release;
      },
      { timeout: 10000 },
    );
    let writer: Promise<unknown> | undefined;
    try {
      await ready;
      writer = realDb.$transaction(
        async (tx) => {
          state.tx = tx;
          const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          writerReady(rows[0]!.pid);
          return retireFlowTemplate(owner.id, template.id, request("POST"));
        },
        { timeout: 10000 },
      );
      const pid = await writerPid;
      await vi.waitFor(
        async () => {
          const rows = await realDb.$queryRaw<
            { blocked: number }[]
          >`SELECT cardinality(pg_blocking_pids(${pid}::integer)) AS blocked`;
          expect(rows[0]!.blocked).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 20 },
      );
      unlock();
      await reader;
      await writer;
      expect(
        (await realDb.flowTemplate.findUniqueOrThrow({ where: { id: template.id } })).retiredAt,
      ).not.toBeNull();
    } finally {
      unlock();
      await reader;
      await writer;
      await realDb.auditLog.deleteMany({ where: { userId: owner.id } });
      await realDb.flowTemplate.delete({ where: { id: template.id } });
      await realDb.user.delete({ where: { id: owner.id } });
    }
  });
});
