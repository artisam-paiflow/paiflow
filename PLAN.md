# Pink Raft — AI Integration Plan

> Branch-per-phase development plan for adding Natural Language → Flow generation and Smart Suggestions.
> Optimized for MacBook Air M2 8GB RAM with background apps.

---

## Model Recommendation

| Spec          | Value                                            |
| ------------- | ------------------------------------------------ |
| **Primary**   | `qwen2.5:3b`                                     |
| **Backup**    | `llama3.2:3b`                                    |
| **Install**   | `ollama pull qwen2.5:3b`                         |
| **RAM usage** | ~1.5–2 GB (Q4_K_M)                               |
| **Speed**     | ~50–150 tokens/sec on M2                         |
| **Why**       | Best structured-JSON reliability in the 3B class |

On an 8GB MacBook Air M2 with macOS + IDE + browser running, a 7B model will likely cause swapping and 3–5s delays. The 3B variant keeps response times under 1–2s while still following our strict JSON prompt format reliably.

If you have extra RAM free during the demo, you can hot-swap to `qwen2.5:7b` with zero code changes.

---

## Branch: `feat/ai-adapter-layer`

**Goal:** Backend abstraction layer. Zero user-facing changes.

### What we build

- `lib/ai/types.ts` — `AiAdapter` interface
- `lib/ai/prompts.ts` — System prompt template + few-shot examples
- `lib/ai/ollama.ts` — Ollama adapter via native `fetch()`
- `lib/ai/openai.ts` — OpenAI adapter via native `fetch()` (dormant)
- `lib/ai/adapter.ts` — Factory reading `AI_PROVIDER` env
- Env vars added to `lib/env.ts` and `.env.example`

### Acceptance criteria

- `pnpm typecheck` passes
- Unit tests mock Ollama/OpenAI fetch calls
- Switching `AI_PROVIDER=openai` works with no other code changes

---

## Branch: `feat/ai-natural-language-flow`

**Goal:** Users type natural language → canvas auto-generates a valid flow.

### What we build

- `app/api/flows/generate/route.ts` — POST endpoint (auth + rate-limit + validation)
- `components/builder/ai-generate-bar.tsx` — Input bar above canvas
- Integration into `components/builder/builder-client.tsx`

### API behavior

1. Rate limit: 5 req/min/user
2. Parse `{ prompt: string }`
3. Call adapter → get raw JSON
4. Validate: `FlowGraphSchema.safeParse()` → `validateFlow()` → `flowToEnglish()`
5. Return `{ ok: true, graph, english }` or `{ ok: false, error }`

### UI behavior

- Input placeholder: _"e.g., When I receive USDC, split 50% to Mom and 50% to Savings"_
- Success: replace canvas nodes/edges, trigger autosave
- Failure: toast with clear message
- AI offline: toast _"AI model offline. Start Ollama or drag blocks manually."_

### Acceptance criteria

- Typed prompt generates valid splitter/streamer/conditional flow
- Invalid prompt returns error, canvas unchanged
- Works end-to-end with local Ollama

---

## Branch: `feat/ai-smart-suggestions`

**Goal:** On-demand AI review that catches mistakes and suggests fixes.

### What we build

- `app/api/flows/suggest/route.ts` — POST endpoint (auth + rate-limit)
- `components/builder/suggestion-panel.tsx` — Dismissible suggestion cards
- Integration into `components/builder/builder-client.tsx`
- Auto-trigger: when `validateFlow()` returns errors after autosave, automatically call suggest endpoint

### API behavior

1. Rate limit: 10 req/min/user
2. Parse `{ graph: FlowGraph }`
3. Call adapter → get suggestions array
4. Return `{ suggestions: Array<{ severity, message }> }`

### Example suggestions

- _"All recipients use the same address. Add unique Stellar addresses."_
- _"Basis points sum to 8,000. Adjust to reach 10,000 (100%)."_
- _"Schedule start date is in the past. Pick a future date."_
- _"Consider adding a label to recipient 2 for clarity."_

### Acceptance criteria

- Click "Ask AI to Review" → see contextual suggestions
- Fix issue → re-review → suggestion disappears
- Auto-trigger on validation failure after autosave
- Works offline with graceful degradation

---

## Branch: `feat/ai-polish-demo`

**Goal:** Prompt tuning, demo UX, and performance hardening.

### What we do

- Tune `lib/ai/prompts.ts` for `qwen2.5:3b` specifically (JSON mode hints, stricter output format)
- Add demo quick-prompt chips to `ai-generate-bar.tsx` ("Split 60/30/10", "Pay salary weekly", "Release if >100 USDC")
- Add loading skeletons and better empty states to suggestion panel
- Add retry logic: if AI returns invalid JSON, retry once with stricter prompt
- Ensure all 3 contract templates generate correctly via NL

### Acceptance criteria

- All 3 template types (splitter, streamer, conditional) generate correctly
- Demo quick-prompts work in <2s
- Invalid JSON from AI is handled with 1 retry
- `pnpm test:e2e` passes

---

## Environment Variables

Add to `.env.example`:

```bash
# ---- AI ----
AI_PROVIDER=ollama          # "ollama" | "openai"
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
OPENAI_API_KEY=             # optional, for future paid switch
OPENAI_MODEL=gpt-4o-mini    # optional
```

---

## Dependencies

**None.** All AI adapters use native `fetch()`. No new npm packages required.
If you later switch to OpenAI and want their SDK, that can be added in a separate branch.

---

## Rollout Order

1. `feat/ai-adapter-layer` → merge to `develop`
2. `feat/ai-natural-language-flow` → merge to `develop`
3. `feat/ai-smart-suggestions` → merge to `develop`
4. `feat/ai-polish-demo` → merge to `develop` → PR to `main`

Each branch can be reviewed and tested independently.
