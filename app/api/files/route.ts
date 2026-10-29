import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(_req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceRateLimit({
      key: `file:retired:${user.id}`,
      limit: 60,
      windowSeconds: 60,
    });
    return NextResponse.json(
      {
        error: {
          code: "FILE_STORAGE_RETIRED",
          message: "Stored-file uploads, downloads and deletion have been retired.",
        },
      },
      { status: 410, headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
