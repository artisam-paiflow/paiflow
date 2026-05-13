import type { AiAdapter, AiMessage } from "./types";
import { AiError } from "./types";

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export class OllamaAdapter implements AiAdapter {
  constructor(private readonly config: OllamaConfig) {}

  async chat(messages: AiMessage[]): Promise<string> {
    const url = new URL("/api/chat", this.config.baseUrl);

    let body: string;
    try {
      body = JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
      });
    } catch (err) {
      throw new AiError("Failed to serialize chat payload", err);
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      throw new AiError("Ollama is unreachable. Start Ollama or drag blocks manually.", err);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new AiError(`Ollama returned ${res.status}: ${text}`);
    }

    let data: OllamaChatResponse;
    try {
      data = (await res.json()) as OllamaChatResponse;
    } catch (err) {
      throw new AiError("Ollama returned invalid JSON", err);
    }

    if (data.error) {
      throw new AiError(`Ollama error: ${data.error}`);
    }

    const content = data.message?.content?.trim();
    if (!content) {
      throw new AiError("Ollama returned an empty response");
    }

    return content;
  }
}
