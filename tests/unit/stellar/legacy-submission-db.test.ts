import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { analyticsEventId } from "@/lib/analytics/event-id";
import { lockDeployment } from "@/lib/deployments/service-work";
import { env } from "@/lib/env";
import {
  admitLegacySubmission,
  registerLegacyPreparation,
  type LegacySubmissionDeployment,
} from "@/lib/stellar/legacy-submission";

const state = vi.hoisted(() => ({ db: null as PrismaClient | null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return state.db!;
  },
}));

// The existing typed DATABASE_URL is the only opt-in. The ordinary setup.ts
// development URL and CI databases skip all fixtures and cleanup in this file.
const dedicatedUrl = (() => {
  const configuredUrl = env().DATABASE_URL;
  try {
    const parsed = new URL(configuredUrl);
    return ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "5532" &&
      /^\/legacy_submission_test(?:_[a-z0-9_]+)?$/.test(parsed.pathname)
      ? configuredUrl
      : undefined;
  } catch {
    return undefined;
  }
})();
const deploymentIds: string[] = [];
const hashes: string[] = [];
const suffix = randomUUID();
const payer = Keypair.random();
let ownerId: string | undefined;
let flowId: string | undefined;
let sequence = 1;
function database(): PrismaClient {
  if (!state.db) throw new Error("Explicit disposable database is not initialized");
  return state.db;
}
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}
async function deployment(): Promise<LegacySubmissionDeployment> {
  const contractAddress = StrKey.encodeContract(randomBytes(32));
  const record = await database().deployment.create({
    data: {
      ownerId: ownerId!,
      flowId: flowId!,
      network: "testnet",
      status: "CONFIRMED",
      contractAddress,
      sourceAccount: payer.publicKey(),
      graphSnapshot: {},
      paramsSnapshot: { kind: "legacy-test-fixture" },
      pipelineSnapshot: [{ nodeId: "root", contractAddress, templateKind: "DEPOSIT_TRIGGER" }],
    },
    include: { flow: { select: { templateKind: true } } },
  });
  deploymentIds.push(record.id);
  return record;
}
function envelope(record: LegacySubmissionDeployment) {
  const transaction = new TransactionBuilder(new Account(payer.publicKey(), String(sequence++)), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(record.contractAddress!).call(
        "deposit",
        new Address(payer.publicKey()).toScVal(),
        nativeToScVal(200n, { type: "i128" }),
      ),
    )
    .setTimeout(180)
    .build();
  const unsignedXdr = transaction.toXDR();
  const txHash = transaction.hash().toString("hex");
  hashes.push(txHash);
  transaction.sign(payer);
  return {
    unsignedXdr,
    signedXdr: transaction.toXDR(),
    txHash,
    maxTime: transaction.timeBounds!.maxTime,
  };
}
type Envelope = ReturnType<typeof envelope>;
function register(record: LegacySubmissionDeployment, transaction: Envelope) {
  return registerLegacyPreparation({
    deployment: record,
    kind: "TRIGGER",
    unsignedXdr: transaction.unsignedXdr,
    sourceAddress: payer.publicKey(),
    contractAddress: record.contractAddress!,
    method: "deposit",
    amount: "200",
  });
}
function admit(record: LegacySubmissionDeployment, transaction: Envelope) {
  return admitLegacySubmission({
    deployment: record,
    kind: "TRIGGER",
    signedXdr: transaction.signedXdr,
    userId: ownerId,
  });
}

describe.skipIf(!dedicatedUrl)("legacy wallet admission on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (!dedicatedUrl)
      throw new Error("Dedicated loopback legacy_submission_test database required");
    state.db = new PrismaClient({ datasourceUrl: dedicatedUrl });
    ownerId = (
      await database().user.create({
        data: { username: `legacy-submission-db-${suffix}`, passwordHash: "unused-test-fixture" },
      })
    ).id;
    flowId = (
      await database().flow.create({
        data: {
          ownerId,
          name: `legacy-submission-db-${suffix}`,
          templateKind: "SPLITTER",
          graph: {},
          parameters: {},
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (!state.db) return;
    try {
      await database().analyticsDelivery.deleteMany({
        where: { id: { in: hashes.map((hash) => analyticsEventId(`testnet:signed:${hash}`)) } },
      });
      await database().walletSubmissionPreparation.deleteMany({
        where: { deploymentId: { in: deploymentIds } },
      });
      await database().signedTransaction.deleteMany({
        where: { deploymentId: { in: deploymentIds } },
      });
      await database().deployment.deleteMany({ where: { id: { in: deploymentIds } } });
      if (flowId) await database().flow.delete({ where: { id: flowId } });
      if (ownerId) await database().user.delete({ where: { id: ownerId } });
    } finally {
      await database().$disconnect();
      state.db = null;
    }
  });

  it("blocks concurrent admissions on the real row lock and admits exactly one first sender", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    await register(record, transaction);
    const originalPreparation = await database().walletSubmissionPreparation.findUniqueOrThrow({
      where: { txHash: transaction.txHash },
    });
    const entered = gate(),
      release = gate();
    const holder = database().$transaction(
      async (tx) => {
        await lockDeployment(tx, record.id);
        entered.open();
        await release.wait;
      },
      { timeout: 10000 },
    );
    await entered.wait;
    const admissions = Promise.all([admit(record, transaction), admit(record, transaction)]);
    try {
      // PostgreSQL witnesses both blocked SELECT FOR UPDATE statements; a
      // createMany uniqueness result alone would not prove lock wiring.
      await expect
        .poll(
          async () => {
            const rows = await database().$queryRaw<Array<{ waiting: bigint }>>`
          SELECT COUNT(*) AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE%' AND pid <> pg_backend_pid()
        `;
            return Number(rows[0]?.waiting ?? 0n);
          },
          { timeout: 3000, interval: 20 },
        )
        .toBe(2);
    } finally {
      release.open();
    }
    const results = await admissions;
    await holder;
    expect(results.map((result) => result.replay).sort()).toEqual([false, true]);
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(1);
    expect(
      await database().analyticsDelivery.count({
        where: { id: analyticsEventId(`testnet:signed:${transaction.txHash}`) },
      }),
    ).toBe(1);
    expect(
      await database().walletSubmissionPreparation.findUniqueOrThrow({
        where: { txHash: transaction.txHash },
      }),
    ).toEqual(originalPreparation);
  });

  it("refuses missing approval and another deployment without writing a signed journal", async () => {
    const original = await deployment(),
      other = await deployment(),
      transaction = envelope(original);
    await expect(admit(original, transaction)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    await register(original, transaction);
    const approval = await database().walletSubmissionPreparation.findUniqueOrThrow({
      where: { txHash: transaction.txHash },
    });
    await expect(admit(other, transaction)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    expect(
      await database().walletSubmissionPreparation.findUniqueOrThrow({
        where: { txHash: transaction.txHash },
      }),
    ).toEqual(approval);
  });

  it("retains expired preparation evidence and refuses its first send without a journal", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    await register(record, transaction);
    const approval = await database().walletSubmissionPreparation.findUniqueOrThrow({
      where: { txHash: transaction.txHash },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue((Number(transaction.maxTime) + 1) * 1000);
    try {
      await expect(admit(record, transaction)).rejects.toMatchObject({ code: "VALIDATION" });
    } finally {
      clock.mockRestore();
    }
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    expect(
      await database().walletSubmissionPreparation.findUniqueOrThrow({
        where: { txHash: transaction.txHash },
      }),
    ).toEqual(approval);
  });

  it("recovers expired historical finality without approval backfill or journal rewriting", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    const historical = await database().signedTransaction.create({
      data: {
        txHash: transaction.txHash,
        signerAddress: payer.publicKey(),
        signedBySource: true,
        kind: "TRIGGER",
        deploymentId: record.id,
        network: "testnet",
        outcome: "CONFIRMED",
        ledger: 123,
        confirmedAt: new Date(),
      },
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue((Number(transaction.maxTime) + 1) * 1000);
    try {
      expect(await admit(record, transaction)).toMatchObject({
        replay: true,
        receipt: { outcome: "CONFIRMED", ledger: 123 },
      });
    } finally {
      clock.mockRestore();
    }
    expect(
      await database().walletSubmissionPreparation.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    expect(
      await database().signedTransaction.findUniqueOrThrow({
        where: { txHash: transaction.txHash },
      }),
    ).toEqual(historical);
  });

  it("refuses a first send when retirement wins the deployment lock", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    await register(record, transaction);
    const entered = gate(),
      release = gate();
    const retiring = database().$transaction(
      async (tx) => {
        await lockDeployment(tx, record.id);
        await tx.deployment.update({
          where: { id: record.id },
          data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
        });
        entered.open();
        await release.wait;
      },
      { timeout: 10000 },
    );
    await entered.wait;
    const pending = admit(record, transaction).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    release.open();
    await retiring;
    expect(await pending).toMatchObject({ error: { code: "CONFLICT" } });
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    expect(
      await database().walletSubmissionPreparation.count({ where: { txHash: transaction.txHash } }),
    ).toBe(1);
  });

  it("rechecks changed deployment evidence after waiting for the lock", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    await register(record, transaction);
    const entered = gate(),
      release = gate();
    const changed = database().$transaction(
      async (tx) => {
        await lockDeployment(tx, record.id);
        await tx.deployment.update({
          where: { id: record.id },
          data: { paramsSnapshot: { changed: true } },
        });
        entered.open();
        await release.wait;
      },
      { timeout: 10000 },
    );
    await entered.wait;
    const pending = admit(record, transaction).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    release.open();
    await changed;
    expect(await pending).toMatchObject({ error: { code: "CONFLICT" } });
    expect(
      await database().signedTransaction.count({ where: { txHash: transaction.txHash } }),
    ).toBe(0);
    expect(
      await database().walletSubmissionPreparation.count({ where: { txHash: transaction.txHash } }),
    ).toBe(1);
  });

  it("enforces approval retention with a RESTRICT foreign key without changing historical journals", async () => {
    const record = await deployment(),
      transaction = envelope(record);
    await register(record, transaction);
    await admit(record, transaction);
    const historical = await database().signedTransaction.findUniqueOrThrow({
      where: { txHash: transaction.txHash },
    });
    await expect(database().deployment.delete({ where: { id: record.id } })).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await database().deployment.count({ where: { id: record.id } })).toBe(1);
    expect(
      await database().walletSubmissionPreparation.count({ where: { txHash: transaction.txHash } }),
    ).toBe(1);
    expect(
      await database().signedTransaction.findUniqueOrThrow({
        where: { txHash: transaction.txHash },
      }),
    ).toEqual(historical);
  });
});
