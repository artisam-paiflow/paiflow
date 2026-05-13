import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { createAiAdapter } from "@/lib/ai/adapter";
import { buildFlowGenerationMessages, buildRetryMessages } from "@/lib/ai/prompts";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { AiError } from "@/lib/ai/types";

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

function extractJson(rawText: string): string {
  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1]!.trim();
  }
  return jsonStr;
}

async function tryGenerate(
  adapter: import("@/lib/ai/types").AiAdapter,
  messages: import("@/lib/ai/types").AiMessage[],
): Promise<{ graph: import("@/lib/flows/schema").FlowGraph; english: string } | null> {
  let rawText: string;
  try {
    rawText = await adapter.chat(messages);
  } catch {
    return null;
  }

  const jsonStr = extractJson(rawText);

  let rawGraph: unknown;
  try {
    rawGraph = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  let graph: import("@/lib/flows/schema").FlowGraph;
  try {
    graph = normalizeFlowGraph(rawGraph);
  } catch {
    return null;
  }

  const v = validateFlow(graph);
  if (!v.ok) return null;

  const english = flowToEnglish(v.graph);
  return { graph: v.graph, english };
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`ai:generate:${user.id}`, 5, 60);
    if (!rl.ok)
      throw new AppError("RATE_LIMITED", "Too many AI generation requests. Try again in a minute.");

    const body = GenerateSchema.parse(await req.json());
    const adapter = createAiAdapter();

    // First attempt
    let result = await tryGenerate(adapter, buildFlowGenerationMessages(body.prompt));

    // Retry once with stricter prompt if first attempt fails
    if (!result) {
      result = await tryGenerate(adapter, buildRetryMessages(body.prompt));
    }

    if (!result) {
      return NextResponse.json({
        ok: false,
        error: "AI returned invalid JSON after retry. Please try again or drag blocks manually.",
      });
    }

    return NextResponse.json({ ok: true, graph: result.graph, english: result.english });
  });
}
