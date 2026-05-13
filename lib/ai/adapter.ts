import { env } from "@/lib/env";
import type { AiAdapter } from "./types";
import { OllamaAdapter } from "./ollama";
import { OpenAiAdapter } from "./openai";

export function createAiAdapter(): AiAdapter {
  const e = env();
  switch (e.AI_PROVIDER) {
    case "ollama":
      return new OllamaAdapter({
        baseUrl: e.OLLAMA_URL,
        model: e.OLLAMA_MODEL,
      });
    case "openai": {
      if (!e.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when AI_PROVIDER is set to 'openai'");
      }
      return new OpenAiAdapter({
        apiKey: e.OPENAI_API_KEY,
        model: e.OPENAI_MODEL,
      });
    }
    default: {
      // exhaustive check
      const _exhaustive: never = e.AI_PROVIDER;
      throw new Error(`Unsupported AI_PROVIDER: ${_exhaustive}`);
    }
  }
}
