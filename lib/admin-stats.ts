import "server-only";
import crypto from "crypto";
import { db } from "@/lib/db";

export async function getWalletConnectionStats() {
  const [totalAgg, uniqueAgg] = await Promise.all([
    db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int as count FROM "AuditLog" WHERE action = 'WALLET_CONNECT'
    `,
    db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(DISTINCT metadata->>'address')::int as count
      FROM "AuditLog"
      WHERE action = 'WALLET_CONNECT'
    `,
  ]);
  return {
    total: totalAgg[0]?.count ?? 0,
    unique: uniqueAgg[0]?.count ?? 0,
  };
}

function addressHash(address: string) {
  return crypto.createHash("sha256").update(address).digest("hex").slice(0, 16);
}

function maskedAddress(address: string) {
  if (address.length <= 13) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export type SubmissionProof = {
  generatedAt: string;
  userCount: number;
  deploymentCount: number;
  walletConnectionTotal: number;
  uniqueWalletAddresses: number;
  recentWalletConnections: Array<{
    addressHash: string;
    maskedAddress: string;
    network: string;
    walletId: string;
    occurredAt: string;
  }>;
  recentOnChainInteractions: Array<{
    txHash: string;
    kind: string;
    occurredAt: string;
  }>;
};

export async function getSubmissionProof(): Promise<SubmissionProof> {
  const [users, deployments, stats, recentConnections, recentEvents] = await Promise.all([
    db.user.count(),
    db.deployment.count(),
    getWalletConnectionStats(),
    db.auditLog.findMany({
      where: { action: "WALLET_CONNECT" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { metadata: true, createdAt: true },
    }),
    db.contractEvent.findMany({
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: { txHash: true, kind: true, occurredAt: true },
    }),
  ]);

  const connections = recentConnections
    .map((c) => {
      const m = c.metadata as { address?: string; network?: string; walletId?: string } | null;
      if (!m?.address) return null;
      return {
        addressHash: addressHash(m.address),
        maskedAddress: maskedAddress(m.address),
        network: m.network ?? "unknown",
        walletId: m.walletId ?? "unknown",
        occurredAt: c.createdAt.toISOString(),
      };
    })
    .filter(Boolean) as SubmissionProof["recentWalletConnections"];

  return {
    generatedAt: new Date().toISOString(),
    userCount: users,
    deploymentCount: deployments,
    walletConnectionTotal: stats.total,
    uniqueWalletAddresses: stats.unique,
    recentWalletConnections: connections,
    recentOnChainInteractions: recentEvents.map((e) => ({
      txHash: e.txHash,
      kind: e.kind,
      occurredAt: e.occurredAt.toISOString(),
    })),
  };
}
