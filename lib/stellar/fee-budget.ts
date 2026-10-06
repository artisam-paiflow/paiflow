import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { AuditAction } from "@/lib/audit";

const StroopsSchema = z.string().regex(/^[1-9]\d{0,18}$/);
export const FeeBudgetSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  limitStroops: StroopsSchema,
});
export type FeeBudget = z.infer<typeof FeeBudgetSchema>;
export const FeeReservationSchema = z.object({
  network: z.enum(["testnet", "mainnet"]),
  budget: FeeBudgetSchema,
  txHash: z.string().regex(/^[a-f0-9]{64}$/),
  payer: z.string().refine(StrKey.isValidEd25519PublicKey),
  declaredFeeStroops: StroopsSchema,
  purpose: z.enum([
    "ttl-extension",
    "ttl-restoration",
    "fixture-setup",
    "fixture-deposit",
    "fixture-payment",
  ]),
});
export type FeeReservation = z.infer<typeof FeeReservationSchema>;

export function ttlFeeBudget(maxFeeStroops: string): FeeBudget | undefined {
  const config = env();
  if (config.STELLAR_TTL_FEE_BUDGET_NAME && config.STELLAR_TTL_FEE_BUDGET_STROOPS) {
    return FeeBudgetSchema.parse({
      name: config.STELLAR_TTL_FEE_BUDGET_NAME,
      limitStroops: config.STELLAR_TTL_FEE_BUDGET_STROOPS,
    });
  }
  if (BigInt(StroopsSchema.parse(maxFeeStroops)) > 1_000_000n) {
    throw new AppError(
      "VALIDATION",
      "TTL maintenance requires a cumulative fee budget for this cap",
    );
  }
  return undefined;
}

class ReservationConflict extends Error {}

/** A permanent, atomic setup claim; failure or unknown finality never releases it. */
export async function claimFixtureSetup(input: FeeBudget): Promise<void> {
  const budget = FeeBudgetSchema.parse(input);
  const network = env().STELLAR_NETWORK;
  await db.$transaction(async (tx) => {
    const changed = await tx.transactionFeeBudget.updateMany({
      where: {
        network,
        name: budget.name,
        limitStroops: budget.limitStroops,
        fixtureSetupClaimedAt: null,
        reservations: { none: { purpose: { in: ["fixture-setup", "fixture-deposit"] } } },
      },
      data: { fixtureSetupClaimedAt: new Date() },
    });
    if (changed.count !== 1)
      throw new AppError(
        "CONFLICT",
        "Fixture setup approval missing or already claimed; reconcile rather than repeat",
      );
    const action = "TTL_FIXTURE_SETUP_CLAIMED" satisfies AuditAction;
    await tx.auditLog.create({
      data: { action, metadata: { network, budgetName: budget.name } },
    });
  });
}

/**
 * Commit BEFORE signing/sending. Every successful reservation remains charged
 * against the ceiling, even after failure, expiry, restart or a refund. This is
 * deliberately conservative: neither uncertain finality nor lost bookkeeping
 * can create new spending capacity. A duplicate hash must never authorize resend.
 */
export async function reserveTransactionFee(input: FeeReservation): Promise<void> {
  const item = FeeReservationSchema.parse(input);
  if (item.network !== env().STELLAR_NETWORK) {
    throw new AppError("VALIDATION", "TTL maintenance fee budget network mismatch");
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const row = await tx.transactionFeeBudget.upsert({
          where: { network_name: { network: item.network, name: item.budget.name } },
          create: {
            network: item.network,
            name: item.budget.name,
            limitStroops: item.budget.limitStroops,
          },
          // A harmless update lets Prisma use a native ON CONFLICT upsert;
          // an empty update can race two first-time campaign creations.
          update: { name: item.budget.name },
        });
        if (row.limitStroops !== item.budget.limitStroops) {
          throw new AppError(
            "VALIDATION",
            "TTL maintenance fee budget limit differs from its durable approval",
          );
        }
        const committed = BigInt(row.committedStroops) + BigInt(item.declaredFeeStroops);
        if (committed > BigInt(row.limitStroops)) {
          throw new AppError("VALIDATION", "TTL maintenance cumulative fee budget exhausted");
        }
        // Compare-and-set works with Postgres READ COMMITTED: a competing update
        // rechecks this predicate after its row lock is released.
        const changed = await tx.transactionFeeBudget.updateMany({
          where: {
            network: item.network,
            name: item.budget.name,
            committedStroops: row.committedStroops,
          },
          data: { committedStroops: committed.toString() },
        });
        if (changed.count !== 1) throw new ReservationConflict();
        await tx.transactionFeeReservation.create({
          data: {
            network: item.network,
            budgetName: item.budget.name,
            txHash: item.txHash,
            payer: item.payer,
            declaredFeeStroops: item.declaredFeeStroops,
            purpose: item.purpose,
          },
        });
        const action = "TRANSACTION_FEE_RESERVED" satisfies AuditAction;
        await tx.auditLog.create({
          data: {
            action,
            metadata: {
              network: item.network,
              budgetName: item.budget.name,
              txHash: item.txHash,
              payer: item.payer,
              declaredFeeStroops: item.declaredFeeStroops,
              purpose: item.purpose,
            },
          },
        });
      });
      return;
    } catch (error) {
      if (
        error instanceof ReservationConflict ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
      )
        continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          "CONFLICT",
          "TTL maintenance fee already reserved; reconcile without resubmission",
        );
      }
      throw error;
    }
  }
  throw new AppError("CONFLICT", "TTL maintenance fee budget busy; no transaction submitted");
}
