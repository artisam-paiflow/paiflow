import { describe, it, expect } from "vitest";
import {
  buildFlowGenerationMessages,
  buildSuggestionMessages,
  FLOW_GENERATION_SYSTEM_PROMPT,
  SUGGESTION_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";

describe("prompts", () => {
  describe("buildFlowGenerationMessages", () => {
    it("starts with the system prompt", () => {
      const messages = buildFlowGenerationMessages("split 50/50");
      expect(messages[0]).toEqual({
        role: "system",
        content: FLOW_GENERATION_SYSTEM_PROMPT,
      });
    });

    it("includes few-shot examples before the user prompt", () => {
      const messages = buildFlowGenerationMessages("pay salary weekly");
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage).toEqual({
        role: "user",
        content: "pay salary weekly",
      });

      // Should have system (1) + 6 examples (12 messages) + final user (1) = 14
      expect(messages.length).toBe(14);
    });
  });

  describe("buildSuggestionMessages", () => {
    it("returns system + user messages", () => {
      const messages = buildSuggestionMessages('{"nodes":[]}');
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "system",
        content: SUGGESTION_SYSTEM_PROMPT,
      });
      expect(messages[1]!.role).toBe("user");
      expect(messages[1]!.content).toContain('{"nodes":[]}');
    });
  });
});
