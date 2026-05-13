import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { FlowPatchSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToParams } from "@/lib/flows/to-params";

async function getOwned(id: string, userId: string) {
  const flow = await db.flow.findFirst({ where: { id, ownerId: userId } });
  if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
  return flow;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const flow = await getOwned(id, user.id);
    return NextResponse.json({ data: flow });
  });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const flow = await getOwned(id, user.id);

    const body = FlowPatchSchema.parse(await req.json());
    let templateKind = flow.templateKind;
    let parameters = flow.parameters;
    let graph = flow.graph;
    if (body.graph) {
      const v = validateFlow(body.graph);
      if (!v.ok) {
        throw new AppError(
          "VALIDATION",
          "Invalid flow graph",
          Object.fromEntries(v.errors.map((e) => [e.path, [e.message]])),
        );
      }
      templateKind = v.templateKind;
      parameters = flowToParams(v.graph, v.templateKind) as object;
      graph = body.graph;
    }

    const updated = await db.flow.update({
      where: { id },
      data: {
        name: body.name ?? flow.name,
        description: body.description ?? flow.description,
        graph: graph as object,
        parameters: parameters as object,
        templateKind,
        version: { increment: 1 },
      },
    });
    await audit({ action: "FLOW_UPDATE", userId: user.id, metadata: { flowId: id } });
    return NextResponse.json({ data: updated });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await getOwned(id, user.id);
    await db.flow.delete({ where: { id } });
    await audit({ action: "FLOW_DELETE", userId: user.id, metadata: { flowId: id } });
    return NextResponse.json({ data: { ok: true } });
  });
}
