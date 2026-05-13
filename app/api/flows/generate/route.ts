import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createAiAdapter } from "@/lib/ai/adapter";
import { buildFlowGenerationMessages } from "@/lib/ai/prompts";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { AiError } from "@/lib/ai/types";

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`ai:generate:${user.id}`, 5, 60);
    if (!rl.ok)
      throw new AppError("RATE_LIMITED", "Too many AI generation requests. Try again in a minute.");

    const body = GenerateSchema.parse(await req.json());
    const adapter = createAiAdapter();
    const messages = buildFlowGenerationMessages(body.prompt);

    let rawText: string;
    try {
      rawText = await adapter.chat(messages);
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ ok: false, error: err.message });
      }
      throw err;
    }

    // Extract JSON from markdown code blocks if present
    let jsonStr = rawText;
    const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1]!;
    }

    let rawGraph: unknown;
    try {
      rawGraph = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({
        ok: false,
        error: "AI returned invalid JSON. Please try again or drag blocks manually.",
      });
    }

    let graph: import("@/lib/flows/schema").FlowGraph;
    try {
      graph = normalizeFlowGraph(rawGraph);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to normalize AI output";
      return NextResponse.json({ ok: false, error: `AI output format error: ${msg}` });
    }

    const v = validateFlow(graph);
    if (!v.ok) {
      const errorText = v.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
      return NextResponse.json({
        ok: false,
        error: `Generated flow is invalid: ${errorText}`,
      });
    }

    const english = flowToEnglish(v.graph);
    return NextResponse.json({ ok: true, graph: v.graph, english });
  });
}
