/**
 * Prompt templates and few-shot examples for AI-powered flow generation
 * and smart suggestions.
 *
 * Maximized for structured-JSON reliability across all common payment phrasings.
 * All functions return plain strings so adapters stay provider-agnostic.
 */

const DUMMY_ADDR = "GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB";

export const FLOW_GENERATION_SYSTEM_PROMPT = getFlowGenerationSystemPrompt();

function getFlowGenerationSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a payment-flow compiler. Turn natural-language payment instructions into a strict JSON flow graph.
Respond with raw JSON ONLY — no markdown, no code fences, no explanations.

JSON structure: { "nodes": [...], "edges": [...] }

## Node types and configs

### Triggers
- on_receive — fires when the contract receives funds
  config: { "asset": "USDC" }
  assets: "XLM", "USDC", or { "kind": "custom", "code": "ABC", "issuer": "G..." }

- on_schedule — fires on a timer
  config: { "interval": "day", "startsAt": "2026-05-20T00:00:00Z" }
  intervals: "minute" | "hour" | "day"

### Actions
- pay — send a fixed amount to one recipient
  config: { "recipient": "G...", "amountStroops": "1000000000", "asset": "USDC" }
  1 unit = 10^7 stroops. Use "${DUMMY_ADDR}" for all recipient addresses.

- split — distribute by percentage to 2-20 recipients
  config: { "asset": "USDC", "recipients": [{ "address": "G...", "bps": 5000, "label": "Mom" }] }
  bps = basis points (1% = 100 bps). MUST sum to EXACTLY 10000.
  Always include descriptive labels. Use "${DUMMY_ADDR}" for all addresses.

### Logic
- condition — gate with comparison
  kinds: amount_gt, amount_lt, oracle_gte, time_after, time_before
  For amount: { "kind": "amount_gt", "amountStroops": "100000000" }

## Critical Rules
1. At least ONE trigger node (pick the primary one if the prompt mentions multiple).
2. At least ONE action (pay or split).
3. Every node should connect toward an action. No dead ends.
4. Split recipients bps must sum to exactly 10000.
5. No cycles.
6. NEVER use markdown code fences or trailing text — raw JSON only.
7. If the prompt describes multiple flows (e.g., "when I receive X, pay Alice, and every day pay Bob"), generate ONE flow using the FIRST trigger/pattern mentioned.

## Pattern Selection
A. SPLITTER (no specific amount): on_receive → split (or pay)
B. STREAMER (time-based): on_schedule → pay
C. CONDITIONAL (amount mentioned in trigger): on_receive → condition → pay OR split
   If user says "when I receive X units of Y", ALWAYS add a condition node with amount_gt.

## Compound Prompts
If a prompt describes multiple scenarios, distill it into ONE primary flow using this priority:
- Streaming + trigger pattern ("receive X, then pay Y every day") → generate the STREAMER (on_schedule → pay), since streaming is the actionable behavior. The received-amount condition is secondary.
- Event + event pattern ("receive USDC, split to mom, and also pay rent every day") → pick the FIRST trigger mentioned
- Multiple amounts → use the first amount for the split/condition
- Multiple recipients → include ALL in one split node

## Phrasing Cheatsheet
- "USD", "USDT", "usdc", "usd" all mean USDC
- "XLM", "lumens", "native" all mean XLM
- "the rest", "the remainder", "remaining" → compute: 10000 - sum(known bps) = rest bps
- "split 50 to mom, 30 to food" (no %) → interpret as percentages (50% = 5000 bps)
- "each", "evenly", "equal" → equal distribution
- "more than", "greater than", "over", "at least", "exceeds" → amount_gt
- "less than", "under", "below" → amount_lt
- "every day", "daily", "each day" → on_schedule interval "day"
- "every hour", "hourly" → on_schedule interval "hour"
- "every month", "monthly", "each month" → on_schedule interval "day" (use daily scheduling)

## Important
- All recipient addresses must be "${DUMMY_ADDR}"
- Today: ${today}. Use future dates for on_schedule startsAt.
- If input is ambiguous, generate the closest valid pattern.
- Split nodes MUST have at least 2 recipients. If only 1 is given, add a second equal-share recipient.`;
}

export const FLOW_GENERATION_RETRY_PROMPT = `Your previous response was invalid. Respond with raw JSON ONLY.

Checklist:
1. Use "config" not "data" inside nodes.
2. Use "amountStroops" not "amount" in pay/condition nodes.
3. Split recipients bps MUST sum to exactly 10000.
4. Exactly ONE trigger and at least ONE action.
5. All strings/keys use double quotes — NO trailing commas.
6. Use ${DUMMY_ADDR} for ALL recipient addresses.
7. If the user mentions "the rest" or "remaining", compute: 10000 - known bps.
8. If percentages are given without "%", treat them as percentages (e.g., 50 = 5000 bps).

Output: { "nodes": [...], "edges": [...] }`;

export const FEW_SHOT_FLOW_EXAMPLES = [
  // ===== SPLITTER PATTERNS (no amount) =====
  {
    user: "When I receive USDC, split 50% to Alice and 50% to Bob",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
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
    user: "Split incoming USDC equally between Alice, Bob, and Carol",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 3333, label: "Alice" },
              { address: DUMMY_ADDR, bps: 3333, label: "Bob" },
              { address: DUMMY_ADDR, bps: 3334, label: "Carol" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I get XLM, send everything to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "XLM" } },
        {
          id: "n2",
          type: "pay",
          config: { asset: "XLM", recipient: DUMMY_ADDR, amountStroops: "1000000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },

  // ===== "THE REST" / "REMAINING" PATTERNS =====
  {
    user: "When I receive USDC, split 60% to Mom, 30% to Food, the rest to Savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 6000, label: "Mom" },
              { address: DUMMY_ADDR, bps: 3000, label: "Food" },
              { address: DUMMY_ADDR, bps: 1000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "Split 50 to mom, 30 to food, the remaining to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Mom" },
              { address: DUMMY_ADDR, bps: 3000, label: "Food" },
              { address: DUMMY_ADDR, bps: 2000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },

  // ===== AMOUNT CONDITION + SPLIT =====
  {
    user: "When I receive 10 USDC, split 50% to Mom and 50% to Food",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "100000000" } },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Mom" },
              { address: DUMMY_ADDR, bps: 5000, label: "Food" },
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
  {
    user: "When I receive 10 USD, split 50 to mom, 30 to food, the rest to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "100000000" } },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Mom" },
              { address: DUMMY_ADDR, bps: 3000, label: "Food" },
              { address: DUMMY_ADDR, bps: 2000, label: "Savings" },
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
  {
    user: "When I receive 100 USDC, split 40 to rent, 40 to food, 20 to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "1000000000" } },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 4000, label: "Rent" },
              { address: DUMMY_ADDR, bps: 4000, label: "Food" },
              { address: DUMMY_ADDR, bps: 2000, label: "Savings" },
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

  // ===== AMOUNT CONDITION + PAY =====
  {
    user: "When I receive more than 50 USDC, send it to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "500000000" } },
        {
          id: "n3",
          type: "pay",
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "500000000" },
        },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    }),
  },
  {
    user: "If I get over 500 XLM, send to cold wallet",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "XLM" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "5000000000" } },
        {
          id: "n3",
          type: "pay",
          config: { asset: "XLM", recipient: DUMMY_ADDR, amountStroops: "5000000000" },
        },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    }),
  },

  // ===== STREAMER PATTERNS =====
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
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "1000000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "Send 50 USDC every hour to the team wallet",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          config: { interval: "hour", startsAt: "2026-05-14T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "500000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "Pay 1000 USDC monthly to savings starting next month",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          config: { interval: "day", startsAt: "2026-06-01T00:00:00Z" },
        },
        {
          id: "n2",
          type: "pay",
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "10000000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },

  // ===== XLM / NATIVE ASSET PATTERNS =====
  {
    user: "When I receive XLM, split 70% to trading, 30% to savings",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "XLM" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "XLM",
            recipients: [
              { address: DUMMY_ADDR, bps: 7000, label: "Trading" },
              { address: DUMMY_ADDR, bps: 3000, label: "Savings" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I receive more than 1000 lumens, send to vault",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "XLM" } },
        {
          id: "n2",
          type: "condition",
          config: { kind: "amount_gt", amountStroops: "10000000000" },
        },
        {
          id: "n3",
          type: "pay",
          config: { asset: "XLM", recipient: DUMMY_ADDR, amountStroops: "10000000000" },
        },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n2", target: "n3" },
      ],
    }),
  },

  // ===== COMPACT / LOWERCASE / UNCONVENTIONAL PHRASING =====
  {
    user: "split incoming usdc 30 to rent 70 to food",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 3000, label: "Rent" },
              { address: DUMMY_ADDR, bps: 7000, label: "Food" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "when i get paid 100 usdt send it to wife and kids evenly",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "1000000000" } },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Wife" },
              { address: DUMMY_ADDR, bps: 5000, label: "Kids" },
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

  // ===== COMPOUND / MULTI-SCENARIO PROMPTS =====
  {
    user: "When I receive USDC, pay Alice 10 USDC and also pay Bob 5 USDC",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        {
          id: "n2",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 6667, label: "Alice" },
              { address: DUMMY_ADDR, bps: 3333, label: "Bob" },
            ],
          },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I receive 50 USDC, split to savings, and every day pay rent 10 USDC",
    assistant: JSON.stringify({
      nodes: [
        { id: "n1", type: "on_receive", config: { asset: "USDC" } },
        { id: "n2", type: "condition", config: { kind: "amount_gt", amountStroops: "500000000" } },
        {
          id: "n3",
          type: "split",
          config: {
            asset: "USDC",
            recipients: [
              { address: DUMMY_ADDR, bps: 5000, label: "Savings" },
              { address: DUMMY_ADDR, bps: 5000, label: "Rent" },
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
  {
    user: "Pay Alice 10 USDC today and send 50 USDC to Bob every week",
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
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "500000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "When I receive 25 USDC, pay Alice 10 USDC every day for 30 days",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          config: {
            interval: "day",
            startsAt: "2026-05-14T00:00:00Z",
            endsAt: "2026-06-13T00:00:00Z",
          },
        },
        {
          id: "n2",
          type: "pay",
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "100000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
    }),
  },
  {
    user: "After receiving 100 USDC, stream 5 USDC daily to savings for 90 days",
    assistant: JSON.stringify({
      nodes: [
        {
          id: "n1",
          type: "on_schedule",
          config: {
            interval: "day",
            startsAt: "2026-05-14T00:00:00Z",
            endsAt: "2026-08-12T00:00:00Z",
          },
        },
        {
          id: "n2",
          type: "pay",
          config: { asset: "USDC", recipient: DUMMY_ADDR, amountStroops: "50000000" },
        },
      ],
      edges: [{ source: "n1", target: "n2" }],
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
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: FLOW_GENERATION_SYSTEM_PROMPT + "\n\n" + FLOW_GENERATION_RETRY_PROMPT,
    },
  ];

  for (const ex of FEW_SHOT_FLOW_EXAMPLES) {
    messages.push({ role: "user", content: ex.user });
    messages.push({ role: "assistant", content: ex.assistant });
  }

  messages.push({ role: "user", content: userPrompt });

  return messages;
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
