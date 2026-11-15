import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { isPendingAddress } from "@/lib/flows/schema";
import {
  OrdinaryFlowGraphSchema,
  isConditionalCanvas,
  type OrdinaryFlowGraph,
} from "@/lib/flows/ordinary-schema";
import { conditionalDraftParameters } from "@/lib/flows/ordinary-flow";
import { issuesToFields } from "@/lib/flows/issues-to-fields";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { writeOrdinaryFlow } from "@/lib/flow-persistence/ordinary-write";
import { upsertAddress } from "@/lib/address-book";
import { refuseIfFeatureOff } from "@/lib/features";
const ResolveSchema = z.object({
  addresses: z.record(
    z.string().min(1).max(64),
    z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  ),
});
export async function POST(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("flowValidate", user.id);
    const { id } = await ctx.params;
    const body = ResolveSchema.parse(await req.json());
    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
    const graph = OrdinaryFlowGraphSchema.parse(structuredClone(flow.graph));
    let replaced = 0;
    // Build a lookup: lowercased label → real address
    const addrMap = new Map<string, string>();
    for (const [label, addr] of Object.entries(body.addresses)) {
      addrMap.set(label.toLowerCase(), addr);
    }
    // Walk through all nodes and replace addresses by matching label
    const nodes = graph.nodes.map((n) => {
      if (n.type === "split") {
        const recipients = n.config.recipients.map((r) => {
          const label = (r.label ?? "unnamed").toLowerCase();
          const resolved = addrMap.get(label);
          if (resolved) {
            replaced++;
            return { ...r, address: resolved };
          }
          return r;
        });
        return { ...n, config: { ...n.config, recipients } };
      }
      if (n.type === "pay" && isPendingAddress(n.config.recipient)) {
        const label = n.config.recipient.slice(8).toLowerCase() || "unnamed";
        const resolved = addrMap.get(label);
        if (resolved) {
          replaced++;
          return { ...n, config: { ...n.config, recipient: resolved } };
        }
      }
      return n;
    });
    const updatedGraph: OrdinaryFlowGraph = { ...graph, nodes };
    if (replaced === 0) {
      throw new AppError("VALIDATION", "No pending addresses matched the provided labels");
    }
    // Validate the updated flow
    const v = isConditionalCanvas(updatedGraph) ? null : validateFlow(updatedGraph);
    if (v && !v.ok) {
      throw new AppError(
        "VALIDATION",
        "Resolved addresses created an invalid flow",
        issuesToFields(v.errors),
      );
    }
    // Save the flow
    const templateKind = v?.ok ? v.templateKind : "ROUTER";
    const pipeline = v?.ok
      ? flowToPipeline(v.graph, undefined, { forValidation: true })
      : conditionalDraftParameters();
    await writeOrdinaryFlow({
      id,
      ownerId: user.id,
      originalGraph: flow.graph,
      replacement: updatedGraph,
      data: {
        parameters: pipeline as object,
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
