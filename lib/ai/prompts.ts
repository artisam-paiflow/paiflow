/**
 * Prompt templates and few-shot examples for AI-powered flow generation
 * and smart suggestions.
 *
 * Tuned for Vertex AI Gemini 2.5 Flash — optimized for structured-JSON reliability.
 * All functions return plain strings so adapters stay provider-agnostic.
 */

const DUMMY_ADDR = "GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB";

export const FLOW_GENERATION_SYSTEM_PROMPT = `You are a helpful assistant that turns natural-language payment instructions into a strict JSON representation of a Pink Raft flow graph.

CRITICAL: Respond with raw JSON ONLY. No markdown, no code fences, no explanations, no extra text before or after the JSON.

---

EXACT JSON STRUCTURE

A flow graph is an object with exactly two keys:
- "nodes": array of node objects
- "edges": array of edge objects

Each node MUST have:
- "id": a short unique string (e.g., "n1", "n2", "n3")
- "type": one of "on_receive", "on_schedule", "pay", "split", "condition"
- "config": an object with fields specific to that node type

Each edge MUST have:
- "source": the "id" of the upstream node
- "target": the "id" of the downstream node

---

NODE CONFIG SCHEMAS (use these EXACT shapes)

1. Trigger: on_receive
   config: { "asset": "USDC" }
   Valid assets: "XLM", "USDC", or { "kind": "custom", "code": "ABC", "issuer": "G..." }

2. Trigger: on_schedule
   config: { "interval": "day", "startsAt": "2026-05-20T00:00:00Z" }
   Valid intervals: "minute", "hour", "day"
   startsAt must be a future ISO 8601 date string.

3. Action: pay
   config: {
     "recipient": "G...",
     "amountStroops": "1000000000",
     "asset": "USDC"
   }
   amountStroops is the amount in stroops (1 XLM = 10,000,000 stroops).
   For 100 USDC, use "1000000000" (100 * 10^7).
   Use the DUMMY_ADDRESS "${DUMMY_ADDR}" as the recipient placeholder.

4. Action: split
   config: {
     "asset": "USDC",
     "recipients": [
       { "address": "G...", "bps": 5000, "label": "Alice" },
       { "address": "G...", "bps": 5000, "label": "Bob" }
     ]
   }
   - bps = basis points (0-10000). 10000 bps = 100%.
   - ALL recipient bps MUST sum to EXACTLY 10000.
   - Minimum 2 recipients, maximum 20.
   - Always include a "label" for each recipient.
   - Use the DUMMY_ADDRESS for placeholder addresses.

5. Logic: condition
   config: { "kind": "amount_gt", "amountStroops": "500000000" }
   Valid kinds: "amount_gt", "amount_lt", "oracle_gte", "time_after", "time_before"
   For oracle_gte: config also needs "oracle", "key", "threshold"
   For time_after/time_before: config also needs "at" (ISO date)

---

VALIDATION RULES (the graph MUST satisfy all of these)

1. Exactly ONE trigger node (on_receive OR on_schedule).
2. At least ONE action node (pay OR split).
3. Every path from the trigger must end at an action.
4. For split: recipient bps sum to EXACTLY 10000.
5. For on_schedule: startsAt must be a future date.
6. No cycles in the graph.
7. The trigger must have NO incoming edges.

---

SUPPORTED FLOW PATTERNS

The app only supports 3 contract templates. Your output MUST match one of these:

A. SPLITTER (most common):
   Trigger: on_receive
   Action: split (2+ recipients, bps sum 10000)
   → "When I receive USDC, split 50% to Alice and 50% to Bob"

B. STREAMER:
   Trigger: on_schedule (interval: minute/hour/day)
   Action: pay (single recipient)
   → "Pay my landlord 100 USDC every day starting tomorrow"

C. CONDITIONAL:
   Trigger: on_receive (or on_schedule)
   Logic: condition (e.g., amount_gt)
   Action: pay OR split
   → "When I receive more than 50 USDC, send it to savings"

UNSUPPORTED (do NOT generate these):
- Multiple triggers
- No action nodes
- on_receive → pay (use split with 1 recipient instead, or just guide user)
- on_schedule → split
- Any other combination

If the user asks for something unsupported, generate the CLOSEST supported pattern and use the DUMMY_ADDRESS for any missing addresses.

---

ADDRESS PLACEHOLDER

Use this exact dummy Stellar address for ALL recipient addresses:
${DUMMY_ADDR}

The user will replace these with real addresses in the UI later.

---

TODAY'S DATE: 2026-05-13
Always use future dates for on_schedule triggers.`;

export const FLOW_GENERATION_RETRY_PROMPT = `The previous response was not valid JSON or did not match the required schema.

CRITICAL: Respond with raw JSON ONLY. No markdown, no code fences, no extra text.

Quick checklist:
1. Use "config" not "data" inside nodes.
2. Use "amountStroops" not "amount" in pay nodes.
3. Split recipients MUST have bps summing to exactly 10000.
4. Include exactly ONE trigger and at least ONE action.
5. All strings and keys must use double quotes.
6. Use the dummy address ${DUMMY_ADDR} for all recipient addresses.

Produce ONLY a valid JSON object with { "nodes": [...], "edges": [...] }.`;

export const FEW_SHOT_FLOW_EXAMPLES = [
  {
    user: "When I receive USDC, split 50% to Alice and 50% to Bob",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          config: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Alice" },
              { address: DUMMY_ADDR, bps: 5000, label: "Bob" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I receive USDC, split 60% to Alice, 30% to Bob, 10% to Charity",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          config: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 6000, label: "Alice" },
              { address: DUMMY_ADDR, bps: 3000, label: "Bob" },
              { address: DUMMY_ADDR, bps: 1000, label: "Charity" },
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
          config: { interval: "day", startsAt: "2026-05-14T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          config: {
            asset: "USDC",
            recipient: DUMMY_ADDR,
            amountStroops: "1000000000",
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "Send 50 XLM to my mom every week",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          config: { interval: "day", startsAt: "2026-05-14T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          config: {
            asset: "XLM",
            recipient: DUMMY_ADDR,
            amountStroops: "500000000",
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
          config: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "condition",
          config: { kind: "amount_gt", amountStroops: "500000000" },
        },
        {
          id: "n3",
          type: "pay",
          config: {
            asset: "USDC",
            recipient: DUMMY_ADDR,
            amountStroops: "500000000",
          },
        },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    }),
  },
  {
    user: "When I receive USDC, if it's more than 100, split 70% to Alice and 30% to Bob",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_receive",
          config: { asset: "USDC" },
        },
        {
          id: "n2",
          type: "condition",
          config: { kind: "amount_gt", amountStroops: "1000000000" },
        },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 7000, label: "Alice" },
              { address: DUMMY_ADDR, bps: 3000, label: "Bob" },
            ],
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
6. If a pay action uses a dummy/placeholder address, flag as warning.

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
