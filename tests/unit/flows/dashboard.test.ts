import { randomUUID } from "node:crypto";
import type { DeploymentServiceState } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dashboardFlows, DashboardFlowQuerySchema } from "@/lib/dashboard/flows";

const owners: string[] = [];
const currentIds: string[] = [];
const retiredIds: string[] = [];
let foreignId: string;

async function flow(ownerId: string, name: string, states: DeploymentServiceState[]) {
  const row = await db.flow.create({
    data: {
      ownerId,
      name,
      templateKind: "SPLITTER",
      graph: {},
      parameters: {},
      // Retired rows are newer: filtering a limited list in memory would hide
      // every current flow. Equal timestamps also exercise the ID tie-breaker.
      updatedAt: new Date(
        states.every((s) => s === "RETIRED") && states.length ? "2026-10-24" : "2026-10-23",
      ),
      deployments: {
        create: states.map((serviceState) => ({
          ownerId,
          serviceState,
          retirementRequestedAt: serviceState === "ACTIVE" ? null : new Date(),
          retiredAt: serviceState === "RETIRED" ? new Date() : null,
          retirementReconciledAt: serviceState === "RETIRED" ? new Date() : null,
          network: "testnet",
          status: "CONFIRMED",
          graphSnapshot: {},
          paramsSnapshot: {},
        })),
      },
    },
  });
  return row.id;
}

beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    owners.push(
      (
        await db.user.create({
          data: { username: `dashboard-${randomUUID()}`, passwordHash: "unused" },
        })
      ).id,
    );
  }
  const ownerId = owners[0]!;
  currentIds.push(await flow(ownerId, "draft", []));
  currentIds.push(await flow(ownerId, "active", ["ACTIVE"]));
  currentIds.push(await flow(ownerId, "retiring", ["RETIRING"]));
  currentIds.push(await flow(ownerId, "mixed active", ["RETIRED", "ACTIVE"]));
  currentIds.push(await flow(ownerId, "mixed retiring", ["RETIRED", "RETIRING"]));
  for (let i = 0; i < 20; i++) currentIds.push(await flow(ownerId, `draft ${i}`, []));
  for (let i = 0; i < 25; i++)
    retiredIds.push(await flow(ownerId, `retired ${i}`, ["RETIRED", "RETIRED"]));
  foreignId = await flow(owners[1]!, "another owner's retired flow", ["RETIRED"]);
});

afterAll(async () => {
  await db.deployment.deleteMany({ where: { ownerId: { in: owners } } });
  await db.flow.deleteMany({ where: { ownerId: { in: owners } } });
  await db.user.deleteMany({ where: { id: { in: owners } } });
});

describe("dashboard flow browsing (Postgres)", () => {
  it.each(["current", "retired"] as const)(
    "filters %s before the limit and paginates without omissions or repeats",
    async (view) => {
      const first = await dashboardFlows(owners[0]!, { view });
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toBe(first.items.at(-1)!.id);
      const second = await dashboardFlows(owners[0]!, { view, cursor: first.nextCursor! });
      expect(second.items).toHaveLength(5);
      expect(second.nextCursor).toBeNull();
      const ids = [...first.items, ...second.items].map((f) => f.id);
      expect(new Set(ids).size).toBe(25);
      expect(ids.sort()).toEqual((view === "current" ? [...currentIds] : [...retiredIds]).sort());
      expect(ids).not.toContain(foreignId);
      for (const item of first.items) expect(item).not.toHaveProperty("graph");
    },
  );

  it("rejects foreign, missing and wrong-view cursors without exposing other definitions", async () => {
    for (const cursor of [foreignId, randomUUID(), currentIds[0]!]) {
      expect(await dashboardFlows(owners[0]!, { view: "retired", cursor })).toEqual({
        items: [],
        nextCursor: null,
      });
    }
  });

  it("retains definitions and all deployment history while browsing", async () => {
    await dashboardFlows(owners[0]!, { view: "retired" });
    expect(await db.flow.count({ where: { ownerId: owners[0] } })).toBe(50);
    expect(await db.deployment.count({ where: { ownerId: owners[0] } })).toBe(56);
  });
});

describe("dashboard query parsing", () => {
  it("accepts the retired view and a UUID cursor", () => {
    const cursor = randomUUID();
    expect(DashboardFlowQuerySchema.parse({ view: "retired", cursor })).toEqual({
      view: "retired",
      cursor,
    });
  });

  it.each([
    {},
    { view: "all", cursor: "invalid" },
    { view: ["retired"], cursor: [randomUUID()] },
    { view: { ownerId: "other" }, cursor: "' OR 1=1" },
  ])("falls back safely for absent or malformed navigation %j", (input) => {
    expect(DashboardFlowQuerySchema.parse(input)).toEqual({ view: "current" });
  });
});
