/**
 * `advanceEventCursor` against the real Postgres the suite uses (see `tests/unit/setup.ts`), since
 * what it guarantees (a slower poll never moves the cursor back) rests on the database's
 * conditional update, not on anything a mock would exercise.
 */
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { advanceEventCursor } from "@/lib/stellar/events";

const suffix = crypto.randomBytes(4).toString("hex");
let userId: string;
let flowId: string;
const deployments: string[] = [];

async function makeDeployment(): Promise<string> {
  const d = await db.deployment.create({
    data: {
      flowId,
      ownerId: userId,
      network: "testnet",
      status: "CONFIRMED",
      graphSnapshot: {},
      paramsSnapshot: {},
    },
  });
  deployments.push(d.id);
  return d.id;
}

const cursorOf = (deploymentId: string) =>
  db.eventCursor.findUniqueOrThrow({ where: { deploymentId } });

beforeAll(async () => {
  userId = (
    await db.user.create({ data: { username: `event-cursor-${suffix}`, passwordHash: "hash" } })
  ).id;
  flowId = (
    await db.flow.create({
      data: {
        ownerId: userId,
        name: "event cursor",
        templateKind: "SPLITTER",
        graph: {},
        parameters: {},
      },
    })
  ).id;
});

afterAll(async () => {
  // Cursors go with their deployments (onDelete: Cascade).
  await db.deployment.deleteMany({ where: { id: { in: deployments } } });
  await db.flow.deleteMany({ where: { id: flowId } });
  await db.user.deleteMany({ where: { id: userId } });
});

describe("advanceEventCursor", () => {
  it("creates the cursor, moves it forward, and never moves it back", async () => {
    const id = await makeDeployment();
    await advanceEventCursor(id, 100);
    expect((await cursorOf(id)).lastLedger).toBe(100);

    await advanceEventCursor(id, 150);
    expect((await cursorOf(id)).lastLedger).toBe(150);

    const before = await cursorOf(id);
    await advanceEventCursor(id, 120);
    const after = await cursorOf(id);
    expect(after.lastLedger).toBe(150);
    // A poll that finished behind the cursor did not bring anything new, so it is not freshness.
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("re-stamps updatedAt when a poll ends on the same ledger", async () => {
    const id = await makeDeployment();
    await advanceEventCursor(id, 100);
    const before = await cursorOf(id);
    await new Promise((r) => setTimeout(r, 5));
    await advanceEventCursor(id, 100);
    const after = await cursorOf(id);
    expect(after.lastLedger).toBe(100);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("keeps the furthest ledger when first polls race to create the cursor", async () => {
    const id = await makeDeployment();
    await Promise.all([200, 100, 300, 250].map((l) => advanceEventCursor(id, l)));
    expect((await cursorOf(id)).lastLedger).toBe(300);
  });
});
