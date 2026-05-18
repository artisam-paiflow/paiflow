export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiAdapter {
  /**
   * Send a list of messages to the AI provider and return the raw text
   * of the assistant's response. Callers are responsible for parsing
   * JSON or any other structured format out of the text.
   */
  chat(messages: AiMessage[]): Promise<string>;
}

/** Generic network / provider error surfaced by all adapters. */
export class AiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "AiError";
  }
}
