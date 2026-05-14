import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createAiAdapter } from "@/lib/ai/adapter";
import { buildSuggestionMessages } from "@/lib/ai/prompts";
import { FlowGraphPatchSchema } from "@/lib/flows/schema";
import { AiError } from "@/lib/ai/types";

const SuggestSchema = z.object({
  graph: FlowGraphPatchSchema,
});

const SuggestionSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`ai:suggest:${user.id}`, 10, 60);
    if (!rl.ok)
      throw new AppError("RATE_LIMITED", "Too many AI suggestion requests. Try again in a minute.");

    const body = SuggestSchema.parse(await req.json());
    const adapter = createAiAdapter();
    const messages = buildSuggestionMessages(JSON.stringify(body.graph, null, 2));

    let rawText: string;
    try {
      rawText = await adapter.chat(messages);
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ suggestions: [] });
      }
      throw err;
    }

    // Extract JSON from markdown code blocks if present
    let jsonStr = rawText;
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1]!;
    }

    let rawSuggestions: unknown;
    try {
      rawSuggestions = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({ suggestions: [] });
    }

    if (!Array.isArray(rawSuggestions)) {
      return NextResponse.json({ suggestions: [] });
    }

    const suggestions = rawSuggestions
      .map((s: unknown) => {
        const parsed = SuggestionSchema.safeParse(s);
        return parsed.success ? parsed.data : null;
      })
      .filter(Boolean) as Array<{ severity: "error" | "warning" | "info"; message: string }>;

    return NextResponse.json({ suggestions });
  });
}
