import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { FlowGraphSchema, isPendingAddress } from "@/lib/flows/schema";
import type { FlowGraph } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToParams } from "@/lib/flows/to-params";
import { upsertAddress } from "@/lib/address-book";

const ResolveSchema = z.object({
  addresses: z.record(
    z.string().min(1).max(64),
    z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  ),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = ResolveSchema.parse(await req.json());

    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");

    const graph = structuredClone(flow.graph) as FlowGraph;
    let replaced = 0;

    // Build a lookup: lowercased label → real address
    const addrMap = new Map<string, string>();
    for (const [label, addr] of Object.entries(body.addresses)) {
      addrMap.set(label.toLowerCase(), addr);
    }

    // Walk through all nodes and replace PENDING:<label> with real addresses
    const nodes = graph.nodes.map((n) => {
      if (n.type === "split") {
        const recipients = n.config.recipients.map((r) => {
          if (isPendingAddress(r.address)) {
            const label = (r.label ?? "unnamed").toLowerCase();
            const resolved = addrMap.get(label);
            if (resolved) {
              replaced++;
              return { ...r, address: resolved };
            }
          }
          return r;
        });
        return { ...n, config: { ...n.config, recipients } };
      }
      if (n.type === "pay" && isPendingAddress(n.config.recipient)) {
        const resolved = addrMap.get("unnamed");
        if (resolved) {
          replaced++;
          return { ...n, config: { ...n.config, recipient: resolved } };
        }
      }
      return n;
    });

    const updatedGraph: FlowGraph = { ...graph, nodes };

    if (replaced === 0) {
      throw new AppError("VALIDATION", "No pending addresses matched the provided labels");
    }

    // Validate the updated flow
    const v = validateFlow(updatedGraph);
    if (!v.ok) {
      throw new AppError(
        "VALIDATION",
        "Resolved addresses created an invalid flow",
        Object.fromEntries(v.errors.map((e) => [e.path, [e.message]])),
      );
    }

    // Save the flow
    const templateKind = v.templateKind;
    const parameters = flowToParams(v.graph, templateKind) as object;

    await db.flow.update({
      where: { id },
      data: {
        graph: updatedGraph as object,
        parameters: parameters as object,
        templateKind,
        version: { increment: 1 },
      },
    });

    // Upsert each resolved address to the user's address book
    for (const [label, addr] of Object.entries(body.addresses)) {
      await upsertAddress(user.id, label, addr).catch(() => {});
    }

    return NextResponse.json({
      data: {
        resolved: replaced,
        flow: updatedGraph,
      },
    });
  });
}
