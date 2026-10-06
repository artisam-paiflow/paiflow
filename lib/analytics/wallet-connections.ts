import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { WalletConnectionInput } from "./schema";
import { analyticsContext } from "./context";
import { enqueueAnalytics } from "./outbox";
import type { Audience } from "./policy";
export async function recordWalletConnection(input: WalletConnectionInput, userId: string | null) {
  if (input.sessionUserId !== userId)
    throw new AppError("CONFLICT", "Wallet connection session changed");
  const context = await analyticsContext(userId);
  if (input.network !== context.stellar_network)
    throw new AppError("VALIDATION", "Wallet network does not match this environment");
  return db.$transaction(async (tx) => {
    const { count } = await tx.walletConnection.createMany({
      data: [
        {
          id: input.connectionId,
          address: input.address,
          network: input.network,
          walletProvider: input.walletId,
          surface: input.surface,
          userId,
          audience: context.audience as Audience,
          trackingVersion: context.tracking_version,
        },
      ],
      skipDuplicates: true,
    });
    if (!count) {
      const prior = await tx.walletConnection.findUniqueOrThrow({
        where: { id: input.connectionId },
      });
      if (
        prior.address !== input.address ||
        prior.network !== input.network ||
        prior.userId !== userId ||
        prior.walletProvider !== input.walletId ||
        prior.surface !== input.surface
      )
        throw new AppError("CONFLICT", "Connection ID already acknowledged for different data");
    }
    if (count)
      await enqueueAnalytics(tx, {
        key: `wallet:${input.connectionId}`,
        distinctId: userId ?? `wallet:${input.address}`,
        name: "wallet_connect_succeeded",
        properties: {
          surface: input.surface,
          wallet_id: input.walletId,
          wallet_address: input.address,
          connection_id: input.connectionId,
        },
        context,
        personProfile: Boolean(userId),
      });
    return { ok: true, connectionId: input.connectionId, created: count === 1 };
  });
}
