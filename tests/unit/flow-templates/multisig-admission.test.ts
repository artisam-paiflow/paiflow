import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  instanceAdmin,
  instanceBindings,
  instanceDefinition,
  instanceVersionId,
} from "@/tests/fixtures/instance-acceptance";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    flowTemplate: { findUniqueOrThrow: vi.fn() },
    flowTemplateVersion: { findFirst: vi.fn(), create: vi.fn() },
    deployment: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
    flow: { create: vi.fn() },
    contractTemplate: { findMany: vi.fn() },
    factoryDeployment: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { tx, transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)) };
});
// These tests exercise real publication/instance admission and binding, stopping
// before immutable writes, artifact lookup or RPC. Database isolation/locking is
// covered by the existing PostgreSQL lifecycle suites.
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(), clientIp: () => "127.0.0.1" }));
import { publishFlowTemplate } from "@/lib/flow-templates/service";
import { prepareTemplateInstance } from "@/lib/flow-instances/service";

const owner = "11111111-1111-4111-8111-111111111111";
const templateId = "22222222-2222-4222-8222-222222222222";
const definition = instanceDefinition("multisig");
const req = () => new NextRequest("http://localhost/api/flow-templates", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([{ id: owner, isActive: true, role: "USER" }]);
  mocks.tx.flowTemplate.findUniqueOrThrow.mockResolvedValue({
    id: templateId,
    ownerId: owner,
    retiredAt: null,
    draftRevision: 1,
    draft: definition,
  });
  mocks.tx.flowTemplateVersion.findFirst.mockResolvedValue({
    id: instanceVersionId,
    templateId,
    definition,
    retiredAt: null,
    expiresAt: null,
    network: "testnet",
    artifacts: {},
  });
  mocks.tx.deployment.findUnique.mockResolvedValue(null);
});

describe("Multisig template admission", () => {
  it("refuses publication of a saved Multisig definition before pinning artifacts or writing a version", async () => {
    await expect(
      publishFlowTemplate(owner, templateId, { expectedRevision: 1 }, req()),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Template uses invalid or unavailable blocks",
    });
    expect(mocks.tx.contractTemplate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.flowTemplateVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("refuses fresh instantiation of a previously published Multisig version before admission", async () => {
    await expect(
      prepareTemplateInstance(
        { id: owner, role: "USER" },
        templateId,
        instanceVersionId,
        {
          sourceAccount: instanceAdmin,
          idempotencyKey: "disabled-multisig-preparation",
          bindings: instanceBindings("multisig", 0),
        },
        req(),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", message: "Bound flow uses unavailable blocks" });
    expect(mocks.tx.contractTemplate.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.deployment.count).not.toHaveBeenCalled();
    expect(mocks.tx.flow.create).not.toHaveBeenCalled();
    expect(mocks.tx.deployment.create).not.toHaveBeenCalled();
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
