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
import type { FlowGraph } from "@/lib/flows/schema";

const GenerateSchema = z.object({
  prompt: z.string().min(1).max(1000),
  model: z.string().optional(),
});

function sanitizePrompt(prompt: string): string {
  return (
    prompt
      // Insert space between number and asset: "10usdc" -> "10 usdc", "10usd" -> "10 usd"
      .replace(/(\d)(usdc|usd|usdt|xlm|str|native|lumens?)\b/gi, "$1 $2")
      // Normalize asset aliases to canonical forms
      .replace(/\b(usdc|usd|usdt)\b/gi, "USDC")
      .replace(/\b(xlm|lumens?|native|str)\b/gi, "XLM")
      // Capitalize first letter for better AI parsing (best-effort, not security-critical)
      .replace(/^[a-z]/, (c) => c.toUpperCase())
      // "the rest to X" / "the remainder to X" -> "the remaining to X" (explicit phrasing)
      .replace(/\bthe rest\b/gi, "the remaining")
      .replace(/\bthe remainder\b/gi, "the remaining")
  );
}

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
    if (e.path === "nodes" && e.message.includes("at least one trigger")) {
      msgs.push(
        "No trigger found. Try starting your prompt with 'When I receive...' or 'Every day...'.",
      );
    } else if (e.path === "nodes" && e.message.includes("at least one action")) {
      msgs.push("No action found. Try adding who should receive the payment.");
    } else if (e.path.includes("recipients") && e.message.includes("sum to 10000")) {
      msgs.push(
        "The split percentages don't add up to 100%. Try rephrasing with exact percentages that sum to 100%.",
      );
    } else if (e.path === "edges" && e.message.includes("cycle")) {
      msgs.push("The flow contains a loop. Try a simpler, linear description.");
    } else if (e.message.includes("not reachable")) {
      msgs.push(
        "Some nodes are disconnected. Try describing the flow in a linear chain (e.g., 'When X happens, then do Y').",
      );
    } else {
      msgs.push(e.message);
    }
  }

  return msgs.join(" ");
}

async function tryGenerate(
  prompt: string,
  model?: string,
): Promise<{ graph: FlowGraph; english: string } | { error: string; guidance?: string }> {
  const adapter = createAiAdapter(model);

  let rawText: string;
  try {
    rawText = await adapter.chat(buildFlowGenerationMessages(prompt));
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
    const sanitizedPrompt = sanitizePrompt(body.prompt);

    const result = await tryGenerate(sanitizedPrompt, body.model);

    if ("error" in result) {
      return NextResponse.json(
        {
          error: { code: "AI_GENERATION_FAILED", message: result.error, guidance: result.guidance },
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ data: { graph: result.graph, english: result.english } });
  });
}
