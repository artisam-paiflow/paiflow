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

function buildActionableError(vResult: import("@/lib/flows/validate").ValidationResult): string {
  if (vResult.ok) return "";

  const msgs: string[] = [];
  for (const e of vResult.errors) {
    if (e.path === "nodes" && e.message.includes("exactly one trigger")) {
      msgs.push(
        "The AI generated a flow with no trigger or too many triggers. Try saying 'When I receive...' or 'Every day...' in your prompt.",
      );
    } else if (e.path === "nodes" && e.message.includes("at least one action")) {
      msgs.push(
        "The AI generated a flow with no action. Try adding who should receive the payment.",
      );
    } else if (e.path.includes("recipients") && e.message.includes("sum to 10000")) {
      msgs.push(
        "The AI generated split percentages that don't add up to 100%. Try rephrasing with exact percentages.",
      );
    } else if (e.path === "edges" && e.message.includes("cycle")) {
      msgs.push("The AI generated a circular flow. Try a simpler description.");
    } else if (e.message.includes("not reachable")) {
      msgs.push(
        "Some nodes are disconnected. Try describing the flow more linearly (e.g., 'When X happens, then do Y').",
      );
    } else {
      msgs.push(e.message);
    }
  }

  return msgs.join(" ");
}

async function tryGenerate(
  adapter: import("@/lib/ai/types").AiAdapter,
  messages: import("@/lib/ai/types").AiMessage[],
): Promise<
  | { graph: import("@/lib/flows/schema").FlowGraph; english: string }
  | { error: string; guidance?: string }
> {
  let rawText: string;
  try {
    rawText = await adapter.chat(messages);
  } catch (err) {
    if (err instanceof AiError) {
      return { error: err.message };
    }
    return { error: "AI service unavailable. Please try again." };
  }

  const jsonStr = extractJson(rawText);

  let rawGraph: unknown;
  try {
    rawGraph = JSON.parse(jsonStr);
  } catch {
    return {
      error: "AI returned text that isn't valid JSON.",
      guidance: "Try rephrasing your prompt more simply, or drag blocks manually.",
    };
  }

  const normalized = normalizeFlowGraph(rawGraph);
  if (!normalized.ok) {
    return {
      error: `AI output format issue: ${normalized.error}`,
      guidance: normalized.detail
        ? `Detail: ${normalized.detail}. Try rephrasing or use a simpler prompt.`
        : "Try rephrasing your prompt more simply.",
    };
  }

  const v = validateFlow(normalized.graph);
  if (!v.ok) {
    const guidance = buildActionableError(v);
    return {
      error: "The generated flow doesn't pass validation.",
      guidance,
    };
  }

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
    if ("error" in result) {
      result = await tryGenerate(adapter, buildRetryMessages(body.prompt));
    }

    if ("error" in result) {
      return NextResponse.json({
        ok: false,
        error: result.error,
        guidance: result.guidance,
      });
    }

    return NextResponse.json({
      ok: true,
      graph: result.graph,
      english: result.english,
    });
  });
}
