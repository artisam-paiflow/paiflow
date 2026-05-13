import { env } from "@/lib/env";
import type { AiAdapter } from "./types";
import { OllamaAdapter } from "./ollama";
import { OpenAiAdapter } from "./openai";
import { GeminiAdapter } from "./gemini";
import { VertexAiAdapter } from "./vertex";

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
    case "gemini": {
      if (!e.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required when AI_PROVIDER is set to 'gemini'");
      }
      return new GeminiAdapter({
        apiKey: e.GEMINI_API_KEY,
        model: e.GEMINI_MODEL,
      });
    }
    case "vertex": {
      if (!e.GCP_PROJECT_ID) {
        throw new Error("GCP_PROJECT_ID is required when AI_PROVIDER is set to 'vertex'");
      }
      return new VertexAiAdapter({
        projectId: e.GCP_PROJECT_ID,
        region: e.GCP_REGION,
        model: e.VERTEX_MODEL,
      });
    }
    default: {
      // exhaustive check
      const _exhaustive: never = e.AI_PROVIDER;
      throw new Error(`Unsupported AI_PROVIDER: ${_exhaustive}`);
    }
  }
}
