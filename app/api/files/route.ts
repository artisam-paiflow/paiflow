import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { storage } from "@/lib/files/storage";
import { enforceRateLimit } from "@/lib/rate-limit";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "application/json",
  "text/plain",
]);

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceRateLimit({
      key: `file:upload:${user.id}`,
      limit: 20,
      windowSeconds: 60 * 10,
      message: "Too many uploads",
    });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new AppError("VALIDATION", "Missing file");
    }
    if (file.size > MAX_BYTES) {
      throw new AppError("VALIDATION", `File too large (max ${MAX_BYTES} bytes)`);
    }
    if (!ALLOWED.has(file.type)) {
      throw new AppError("VALIDATION", `Disallowed content type: ${file.type}`);
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const key = `${user.id}/${randomUUID()}`;
    await storage().put(key, buf, file.type);
    const record = await db.fileAsset.create({
      data: {
        ownerId: user.id,
        storageKey: key,
        filename: file.name.slice(0, 200),
        contentType: file.type,
        size: file.size,
      },
      select: { id: true, filename: true, contentType: true, size: true, createdAt: true },
    });
    return NextResponse.json({ data: record }, { status: 201 });
  });
}
