import type { AiAdapter, AiMessage } from "./types";
import { AiError } from "./types";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  error?: {
    type: string;
    message: string;
  };
}

export class AnthropicAdapter implements AiAdapter {
  constructor(private readonly config: AnthropicConfig) {}

  async chat(messages: AiMessage[]): Promise<string> {
    const url = "https://api.anthropic.com/v1/messages";

    // Anthropic uses "system" as a top-level param, not a message role.
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const system = systemMessages.map((m) => m.content).join("\n\n");

    const anthropicMessages = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: 1024,
      temperature: 0.1,
      system: system || undefined,
      messages: anthropicMessages,
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body,
      });
    } catch (err) {
      throw new AiError("Anthropic API is unreachable. Check your network or API key.", err);
    }

    let rawBody: string;
    try {
      rawBody = await res.text();
    } catch (err) {
      throw new AiError("Anthropic returned unreadable body", err);
    }

    let data: AnthropicResponse;
    try {
      data = JSON.parse(rawBody) as AnthropicResponse;
    } catch {
      throw new AiError(
        `Anthropic returned invalid JSON (HTTP ${res.status}). Raw: ${rawBody.slice(0, 300)}`,
      );
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      throw new AiError(
        `Anthropic error: ${msg} (HTTP ${res.status}). Raw: ${rawBody.slice(0, 300)}`,
      );
    }

    const text = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!text) {
      throw new AiError(`Anthropic returned an empty response. Raw: ${rawBody.slice(0, 300)}`);
    }

    return text;
  }
}
