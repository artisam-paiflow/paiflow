import type { AiAdapter, AiMessage } from "./types";
import { AiError } from "./types";

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: {
    message: string;
    code: number;
  };
}

export class GeminiAdapter implements AiAdapter {
  constructor(private readonly config: GeminiConfig) {}

  async chat(messages: AiMessage[]): Promise<string> {
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model}:generateContent`,
    );
    url.searchParams.set("key", this.config.apiKey);

    // Gemini contents only support "user" and "model" roles.
    // System instructions are passed as the first user message.
    const contents: GeminiContent[] = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    });

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      throw new AiError("Gemini API is unreachable. Check your network or API key.", err);
    }

    let data: GeminiResponse;
    try {
      data = (await res.json()) as GeminiResponse;
    } catch (err) {
      throw new AiError("Gemini returned invalid JSON", err);
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `Gemini returned ${res.status}`;
      throw new AiError(`Gemini error: ${msg}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new AiError("Gemini returned no candidates");
    }

    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      throw new AiError(`Gemini finished with reason: ${candidate.finishReason}`);
    }

    const text = candidate.content?.parts?.[0]?.text?.trim();
    if (!text) {
      throw new AiError("Gemini returned an empty response");
    }

    return text;
  }
}
