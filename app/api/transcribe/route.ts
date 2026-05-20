import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { transcribeAudio } from "@/lib/ai/groq";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set(["audio/webm", "audio/mp4", "audio/wav"]);

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();

    await enforceRateLimit({
      key: `transcribe:${user.id}`,
      limit: 20,
      windowSeconds: 10 * 60,
      message: "Too many transcription requests",
    });

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new AppError("VALIDATION", "Missing audio file");
    }
    const baseType = file.type.split(";")[0]!;
    if (!ALLOWED_MIME.has(baseType)) {
      throw new AppError(
        "VALIDATION",
        `Unsupported content type: ${file.type}. Allowed: audio/webm, audio/mp4, audio/wav`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new AppError("VALIDATION", "Audio file too large (max 25 MB)");
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const text = await transcribeAudio(buf, file.name, baseType);

    return NextResponse.json({ data: { text } });
  });
}
