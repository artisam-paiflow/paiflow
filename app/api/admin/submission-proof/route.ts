import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { Role } from "@prisma/client";
import { getSubmissionProof } from "@/lib/admin-stats";

function escapeCsv(value: string | number) {
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await requireSession({ role: Role.ADMIN });
    const format = new URL(req.url).searchParams.get("format") ?? "json";
    const proof = await getSubmissionProof();

    if (format === "csv") {
      const rows: (string | number)[][] = [
        ["metric", "value"],
        ["generatedAt", proof.generatedAt],
        ["userCount", proof.userCount],
        ["deploymentCount", proof.deploymentCount],
        ["walletConnectionTotal", proof.walletConnectionTotal],
        ["uniqueWalletAddresses", proof.uniqueWalletAddresses],
        [],
        ["recentWalletConnections"],
        ["addressHash", "maskedAddress", "network", "walletId", "occurredAt"],
        ...proof.recentWalletConnections.map((c) => [
          c.addressHash,
          c.maskedAddress,
          c.network,
          c.walletId,
          c.occurredAt,
        ]),
        [],
        ["recentOnChainInteractions"],
        ["txHash", "kind", "occurredAt"],
        ...proof.recentOnChainInteractions.map((e) => [e.txHash, e.kind, e.occurredAt]),
      ];
      const csv = rows.map((r) => r.map(escapeCsv).join(",")).join("\n");
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv",
          "content-disposition": "attachment; filename=paiflow-submission-proof.csv",
        },
      });
    }

    return NextResponse.json({ data: proof });
  });
}
