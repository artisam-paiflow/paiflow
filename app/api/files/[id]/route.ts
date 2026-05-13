import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { storage } from "@/lib/files/storage";

export const runtime = "nodejs";

function safeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, "").slice(0, 200);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSessionUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  const f = await db.fileAsset.findFirst({
    where: { id, ownerId: session.id },
  });
  if (!f) throw new AppError("NOT_FOUND", "File not found");
  const { stream, size } = await storage().get(f.storageKey);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": f.contentType,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${safeFilename(f.filename)}"`,
      "Cache-Control": "private, max-age=0, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSessionUser();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const f = await db.fileAsset.findFirst({ where: { id, ownerId: session.id } });
  if (!f) return new Response("Not found", { status: 404 });
  await storage().remove(f.storageKey);
  await db.fileAsset.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
