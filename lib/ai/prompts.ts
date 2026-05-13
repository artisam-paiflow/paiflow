/**
 * Prompt templates and few-shot examples for AI-powered flow generation
 * and smart suggestions.
 *
 * Tuned for qwen2.5:3b — optimized for structured-JSON reliability.
 * All functions return plain strings so adapters stay provider-agnostic.
 */

export const FLOW_GENERATION_SYSTEM_PROMPT = `You are a helpful assistant that turns natural-language payment instructions into a strict JSON representation of a Pink Raft flow graph.

CRITICAL: Respond with raw JSON ONLY. No markdown, no code fences (no \`\`\`json), no explanations, no extra text before or after the JSON.

A flow graph has:
- "nodes": an array of block objects
- "edges": an array of connection objects

Allowed node types (block types):
- trigger: "on_receive" or "on_schedule"
- action:  "pay" or "split"
- logic:   "condition"

Each node must have:
- id: a short unique string (e.g., "n1", "n2")
- type: one of the block types above
- data: an object with config fields specific to that block

Edges connect nodes:
- source: id of the upstream node
- target: id of the downstream node

Rules:
1. Exactly ONE trigger node.
2. Every path must end in at least ONE action node.
3. For "split" actions, recipients is an array of { address: string, bps: number } where bps are basis points (0-10000) and must sum to exactly 10000.
4. For "on_receive" trigger, asset is "XLM", "USDC", or { code: string, issuer: string }.
5. For "on_schedule" trigger, interval is "minute", "hour", or "day", with startsAt ISO date.
6. Output ONLY valid JSON. No markdown, no explanations outside the JSON.`;

export const FLOW_GENERATION_RETRY_PROMPT = `The previous response was not valid JSON or did not follow the required schema.

CRITICAL: Respond with raw JSON ONLY. No markdown, no code fences, no extra text.

Produce a valid flow graph with:
- nodes: array of { id, type, data }
- edges: array of { source, target }

Make sure the JSON is syntactically correct and uses double quotes for all strings and keys.`;

export const FEW_SHOT_FLOW_EXAMPLES = [
  {
    user: "When I receive USDC, split 50% to Mom and 50% to Savings",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          data: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "split",
          data: {
            asset: "USDC",
            recipients: [
              { address: "GABC...", bps: 5000, label: "Mom" },
              { address: "GDEF...", bps: 5000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "Pay my landlord 100 USDC every day starting tomorrow",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          data: { interval: "day", startsAt: "2026-05-14T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          data: {
            asset: "USDC",
            recipient: "GXYZ...",
            amount: "1000000000",
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I receive more than 50 USDC, send it to my savings wallet",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          data: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "condition",
          data: { kind: "amount_gt", amount: "500000000" },
        },
        {
          id: "n3",
          type: "pay",
          data: {
            asset: "USDC",
            recipient: "GSAVE...",
            amount: "500000000",
          },
        },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    }),
  },
];

export const SUGGESTION_SYSTEM_PROMPT = `You are a meticulous reviewer of Pink Raft payment flows.
Given a flow graph (JSON), review it for correctness, clarity, and best practices.

CRITICAL: Respond with raw JSON ONLY. No markdown, no code fences, no extra text.

Return a JSON array of suggestions. Each suggestion is an object with:
- severity: "error" | "warning" | "info"
- message: a concise, actionable sentence

Rules for reviewing:
1. If all split recipients share the same address, flag as error.
2. If split basis points do not sum to 10000, flag as error.
3. If a schedule start date is in the past, flag as error.
4. If a recipient lacks a label, suggest adding one (info).
5. If a condition has no downstream action, flag as error.

Output ONLY valid JSON array. No markdown, no extra text.`;

export function buildFlowGenerationMessages(userPrompt: string): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: FLOW_GENERATION_SYSTEM_PROMPT,
    },
  ];

  for (const ex of FEW_SHOT_FLOW_EXAMPLES) {
    messages.push({ role: "user", content: ex.user });
    messages.push({ role: "assistant", content: ex.assistant });
  }

  messages.push({ role: "user", content: userPrompt });

  return messages;
}

export function buildRetryMessages(userPrompt: string): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  return [
    {
      role: "system",
      content: FLOW_GENERATION_SYSTEM_PROMPT + "\n\n" + FLOW_GENERATION_RETRY_PROMPT,
    },
    { role: "user", content: userPrompt },
  ];
}

export function buildSuggestionMessages(flowGraphJson: string): Array<{
  role: "system" | "user" | "assistant";
  content: string;
}> {
  return [
    { role: "system", content: SUGGESTION_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Review this flow graph and return a JSON array of suggestions:\n\n${flowGraphJson}`,
    },
  ];
}
