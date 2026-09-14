/**
 * `wasTxSubmittedFor` is the only Prisma JSON-path filter in the codebase, and
 * a wrong path is invisible to `tsc` — the query simply stops matching, which
 * would silently cost every confirmed trigger its fast event ingest. So this
 * runs against the real Postgres the suite already uses (see
 * `tests/unit/setup.ts`, which preserves DATABASE_URL) rather than a mock.
 */
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { audit, wasTxSubmittedFor } from "@/lib/audit";

const DEPLOYMENT_ID = "44c3ed53-9b6d-4be0-bade-e5fcc6c7a0eb";
const OTHER_DEPLOYMENT_ID = "00000000-0000-0000-0000-000000000000";
const TX_HASH = "8d8707228a6b1d30b01dd2f5c6d956961f090cd9cd690c73d994f7a8a4ec8f3f";
const OTHER_TX_HASH = "1".repeat(64);

describe("wasTxSubmittedFor", () => {
  afterEach(async () => {
    await db.auditLog.deleteMany({
      where: {
        action: {
          in: ["DEPLOY_TRIGGER", "DEPLOY_INVOKE", "API_EXECUTE_SUBMITTED", "DEV_UPDATE_RECIPIENTS"],
        },
      },
    });
  });

  it("finds a transaction this app submitted for this deployment", async () => {
    await audit({
      action: "DEPLOY_TRIGGER",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, TX_HASH)).toBe(true);
  });

  it("matches on every submit action, not just the trigger", async () => {
    await audit({
      action: "DEPLOY_INVOKE",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, TX_HASH)).toBe(true);
  });

  it("matches a submission through the partner API", async () => {
    await audit({
      action: "API_EXECUTE_SUBMITTED",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, TX_HASH)).toBe(true);
  });

  it("does not match a different transaction on the same deployment", async () => {
    await audit({
      action: "DEPLOY_TRIGGER",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, OTHER_TX_HASH)).toBe(false);
  });

  // The one that matters: pairing a real hash with someone else's deployment is
  // what would let a caller publish a fabricated event into their feed.
  it("does not match the same transaction on a different deployment", async () => {
    await audit({
      action: "DEPLOY_TRIGGER",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(OTHER_DEPLOYMENT_ID, TX_HASH)).toBe(false);
  });

  it("ignores actions that are not a submission, even with the right pair", async () => {
    await audit({
      action: "DEV_UPDATE_RECIPIENTS",
      metadata: { deploymentId: DEPLOYMENT_ID, txHash: TX_HASH },
    });
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, TX_HASH)).toBe(false);
  });

  it("returns false when no row exists at all", async () => {
    expect(await wasTxSubmittedFor(DEPLOYMENT_ID, TX_HASH)).toBe(false);
  });
});
