import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { FlowSaveSchema } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { searchParams } = new URL(req.url);
    const q = ListQuerySchema.parse(Object.fromEntries(searchParams));
    const items = await db.flow.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      select: {
        id: true,
        name: true,
        description: true,
        templateKind: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    const nextCursor = items.length > q.limit ? items.pop()!.id : null;
    return NextResponse.json({ data: { items, nextCursor } });
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`flow:write:${user.id}`, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many writes");

    const body = FlowSaveSchema.parse(await req.json());
    const v = validateFlow(body.graph);
    if (!v.ok) {
      throw new AppError(
        "VALIDATION",
        "Invalid flow graph",
        Object.fromEntries(v.errors.map((e) => [e.path, [e.message]])),
      );
    }
    const pipeline = flowToPipeline(v.graph);

    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: body.name,
        description: body.description,
        templateKind: v.templateKind,
        graph: body.graph,
        parameters: pipeline as object,
      },
    });
    await audit({
      action: "FLOW_CREATE",
      userId: user.id,
      ip: clientIp(req),
      metadata: { flowId: flow.id },
    });
    return NextResponse.json({ data: flow }, { status: 201 });
  });
}
