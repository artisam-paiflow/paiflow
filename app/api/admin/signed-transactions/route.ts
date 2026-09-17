import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";

const Query = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  address: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
    .optional(),
  userId: z.string().uuid().optional(),
  deploymentId: z.string().uuid().optional(),
  txHash: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "txHash must be 64 hex characters")
    .transform((h) => h.toLowerCase())
    .optional(),
});

/**
 * Admin lookup over `SignedTransaction`, the record of which wallet signed
 * which transaction under which app account. Each filter answers one of the
 * questions the table exists for: `userId` lists a user's wallets, `address`
 * finds the user behind a wallet, `txHash` gives both for one transaction.
 *
 * A row's `userId` is the signer's own session user; null means the signer
 * had no session. The joined deployment's `ownerId` is the owner and is not
 * the signer — the public trigger page lets anyone fund anyone's flow.
 *
 * Cursor pagination: `nextCursor` is the id of the last row on this page,
 * and the next request skips it. Newest first, ties broken on id so the
 * order is total.
 */
export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
    const items = await db.signedTransaction.findMany({
      where: {
        ...(q.address ? { signerAddress: q.address } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.deploymentId ? { deploymentId: q.deploymentId } : {}),
        ...(q.txHash ? { txHash: q.txHash } : {}),
      },
      select: {
        id: true,
        txHash: true,
        signerAddress: true,
        feeSourceAddress: true,
        muxedSource: true,
        isFeeBump: true,
        signedBySource: true,
        kind: true,
        network: true,
        ip: true,
        createdAt: true,
        userId: true,
        deploymentId: true,
        user: { select: { id: true, username: true } },
        deployment: { select: { id: true, ownerId: true, flowId: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    });
    const hasMore = items.length > q.limit;
    if (hasMore) items.pop();
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    return NextResponse.json({ data: { items, nextCursor } });
  });
}
