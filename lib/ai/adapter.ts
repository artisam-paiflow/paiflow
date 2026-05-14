import { env } from "@/lib/env";
import type { AiAdapter } from "./types";
import { AnthropicAdapter } from "./anthropic";

export function createAiAdapter(modelOverride?: string): AiAdapter {
  const e = env();
  return new AnthropicAdapter({
    apiKey: e.ANTHROPIC_API_KEY,
    model: modelOverride ?? e.ANTHROPIC_MODEL,
  });
}
