import "server-only";
import { AppError } from "@/lib/errors";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function extractJson(text: string): string | null {
  // Try to extract JSON from markdown code blocks
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) return codeBlock[1].trim();

  // Try to find JSON object/array boundaries
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start = Math.min(objStart >= 0 ? objStart : Infinity, arrStart >= 0 ? arrStart : Infinity);
  if (start === Infinity) return null;

  // Find matching closing brace/bracket
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  const open = text[start];
  const close = open === "{" ? "}" : "]";

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === open) depth++;
      if (ch === close) depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

export async function callGroq(
  messages: GroqMessage[],
  opts: { model?: string; temperature?: number; responseFormat?: "json_object" | "text" } = {},
): Promise<unknown> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "INTERNAL",
      "Groq API key is not configured. Set GROQ_API_KEY in your environment.",
    );
  }

  const model = opts.model ?? process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const temperature = opts.temperature ?? 0.2;

  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
  };

  if (opts.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    throw new AppError("UPSTREAM_RPC", `Groq request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new AppError("UPSTREAM_RPC", "Empty response from Groq");

  // First try direct parse
  try {
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown or partial content
    const extracted = extractJson(content);
    if (extracted) {
      try {
        return JSON.parse(extracted);
      } catch {
        // fall through to error
      }
    }
    throw new AppError("UPSTREAM_RPC", `Groq returned invalid JSON: ${content.slice(0, 200)}`);
  }
}
