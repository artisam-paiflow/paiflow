import "server-only";
import { AppError } from "@/lib/errors";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function extractJson(text: string): string | null {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) return codeBlock[1].trim();

  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const start = Math.min(objStart >= 0 ? objStart : Infinity, arrStart >= 0 ? arrStart : Infinity);
  if (start === Infinity) return null;

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

function stripNulls(obj: unknown): unknown {
  if (obj === null) return undefined;
  if (Array.isArray(obj)) {
    return obj.map(stripNulls).filter((v) => v !== undefined);
  }
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const cleaned = stripNulls(value);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result;
  }
  return obj;
}

function getModelChain(callerModel?: string): string[] {
  if (callerModel) return [callerModel];
  const primary = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
  const fallbacksRaw = process.env.GROQ_FALLBACK_MODELS ?? "";
  const fallbacks = fallbacksRaw
    ? fallbacksRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b"];
  return [primary, ...fallbacks];
}

async function tryModel(
  apiKey: string,
  model: string,
  temperature: number,
  messages: GroqMessage[],
  responseFormat?: "json_object" | "text",
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages,
  };

  if (responseFormat === "json_object") {
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
    const code = res.status === 429 ? "RATE_LIMITED" : "UPSTREAM_RPC";
    throw new AppError(code, `Groq request failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new AppError("UPSTREAM_RPC", "Empty response from Groq");

  try {
    return stripNulls(JSON.parse(content));
  } catch {
    const extracted = extractJson(content);
    if (extracted) {
      try {
        return stripNulls(JSON.parse(extracted));
      } catch {
        // fall through to error
      }
    }
    throw new AppError("UPSTREAM_RPC", `Groq returned invalid JSON: ${content.slice(0, 200)}`);
  }
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

  const models = getModelChain(opts.model);
  const temperature = opts.temperature ?? 0.2;
  const rawErrors: Array<{ model: string; status: number; message: string }> = [];

  for (const model of models) {
    try {
      return await tryModel(apiKey, model, temperature, messages, opts.responseFormat);
    } catch (err) {
      if (err instanceof AppError && (err.code === "UPSTREAM_RPC" || err.code === "RATE_LIMITED")) {
        const statusMatch = err.message.match(/Groq request failed: (\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : 0;
        rawErrors.push({ model, status, message: err.message });
        continue;
      }
      throw err;
    }
  }

  const allRatedLimited = rawErrors.every((e) => e.status === 429);
  if (allRatedLimited) {
    throw new AppError(
      "RATE_LIMITED",
      "All Groq AI models are currently rate-limited. Please try again later (limits reset daily).",
    );
  }

  const details = Object.fromEntries(rawErrors.map((e) => [e.model, [e.message]]));
  throw new AppError(
    "UPSTREAM_RPC",
    "All Groq AI models failed. Check your API key or try again later.",
    details,
  );
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType = "audio/webm",
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "INTERNAL",
      "Groq API key is not configured. Set GROQ_API_KEY in your environment.",
    );
  }

  const primary = process.env.GROQ_STT_MODEL_PRIMARY ?? "whisper-large-v3";
  const fallback = process.env.GROQ_STT_MODEL_FALLBACK ?? "whisper-large-v3-turbo";
  const models = Array.from(new Set([primary, fallback]));
  const rawErrors: Array<{ model: string; status: number }> = [];

  async function tryModel(model: string): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", blob, filename);
    formData.append("model", model);

    const res = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown");
      rawErrors.push({ model, status: res.status });
      throw new AppError(
        res.status === 429 ? "RATE_LIMITED" : "UPSTREAM_RPC",
        `Groq transcription failed: ${res.status} ${text}`,
      );
    }

    const json = (await res.json()) as { text?: string };
    if (!json.text) throw new AppError("UPSTREAM_RPC", "Empty transcription response from Groq");
    return json.text!;
  }

  let attempt = 0;
  for (const model of models) {
    try {
      return await tryModel(model);
    } catch (err) {
      if (
        !(err instanceof AppError) ||
        (err.code !== "UPSTREAM_RPC" && err.code !== "RATE_LIMITED")
      ) {
        throw err;
      }
      if (attempt < models.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      attempt++;
    }
  }

  const allRatedLimited = rawErrors.length > 0 && rawErrors.every((e) => e.status === 429);
  if (allRatedLimited) {
    throw new AppError(
      "RATE_LIMITED",
      "Groq STT is currently rate-limited. Please try again later.",
    );
  }

  throw new AppError("UPSTREAM_RPC", "Groq transcription failed on all models.");
}
