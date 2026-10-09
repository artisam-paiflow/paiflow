import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp, rateLimitedError } from "@/lib/rate-limit";
import { TemplateKind } from "@prisma/client";
import { STARTER_GRAPH } from "@/lib/flows/starter";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80).default("Untitled flow"),
});

/**
 * Explicit "create a new starter flow" endpoint. Previously the `/flows/new`
 * page created a row on every GET (issue #278), so accidental navigation or
 * double-clicks accumulated blank flows. Creation now only happens here, on an
 * explicit POST from the "New flow" confirmation dialog.
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`flow:write:${user.id}`, 30, 60);
    if (!rl.ok) throw rateLimitedError(rl, "Too many writes");

    const account = await db.user.findUnique({ where: { id: user.id }, select: { email: true } });
    const { name } = CreateSchema.parse(await req.json().catch(() => ({})));

    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name,
        templateKind: TemplateKind.SPLITTER,
        graph: {
          ...STARTER_GRAPH,
          notify: {
            mode: user.role === "SANDBOX" ? "off" : "every_transaction",
            sendTo: user.role === "SANDBOX" ? "" : (account?.email ?? ""),
          },
        } as object,
        parameters: {
          kind: "splitter",
          asset: { kind: "known", symbol: "USDC" },
          recipients: STARTER_GRAPH.nodes[1]!.config.recipients.map((r) => ({
            address: r.address,
            bps: r.bps,
          })),
        } as object,
      },
    });
    await audit({
      action: "FLOW_CREATE",
      userId: user.id,
      ip: clientIp(req),
      metadata: { flowId: flow.id },
    });
    return NextResponse.json({ data: { id: flow.id } }, { status: 201 });
  });
}
