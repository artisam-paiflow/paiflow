import type { AiAdapter, AiMessage } from "./types";
import { AiError } from "./types";

export interface OpenAiConfig {
  apiKey: string;
  model: string;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAiAdapter implements AiAdapter {
  constructor(private readonly config: OpenAiConfig) {}

  async chat(messages: AiMessage[]): Promise<string> {
    const url = "https://api.openai.com/v1/chat/completions";

    let body: string;
    try {
      body = JSON.stringify({
        model: this.config.model,
        messages,
        temperature: 0.2,
      });
    } catch (err) {
      throw new AiError("Failed to serialize chat payload", err);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
      });
    } catch (err) {
      throw new AiError("OpenAI is unreachable", err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new AiError(`OpenAI returned ${res.status}: ${text}`);
    }

    let data: OpenAiChatResponse;
    try {
      data = (await res.json()) as OpenAiChatResponse;
    } catch (err) {
      throw new AiError("OpenAI returned invalid JSON", err);
    }

    if (data.error?.message) {
      throw new AiError(`OpenAI error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new AiError("OpenAI returned an empty response");
    }

    return content;
  }
}
