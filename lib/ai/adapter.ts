import { env } from "@/lib/env";
import type { AiAdapter } from "./types";
import { AnthropicAdapter } from "./anthropic";

export function createAiAdapter(modelOverride?: string): AiAdapter {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when using the Anthropic adapter");
  }
  return new AnthropicAdapter({
    apiKey: e.ANTHROPIC_API_KEY,
    model: modelOverride ?? e.ANTHROPIC_MODEL,
  });
}
