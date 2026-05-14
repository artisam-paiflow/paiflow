# Session Summary — AI Integration for Pink Raft

**Branch:** `feat/ai-adapter-layer`  
**Date:** 2026-05-13  
**Scope:** Natural Language → Flow generation, Smart Suggestions, Multi-provider AI adapters, UI/UX hardening  
**Base:** `origin/main` (commit `84769d6`)

---

## Overview

This session added a complete AI layer to Pink Raft that lets users describe payment flows in plain English and auto-generates valid Stellar smart-contract graphs. It also added a smart-suggestions system (later hidden for MVP simplicity), multiple AI provider support (Ollama local, Gemini API, Vertex AI/GCP), and extensive UI/UX hardening for hackathon demo stability.

**Total commits:** 18  
**Files changed:** 43 files, ~2,955 insertions, ~116 deletions  
**Unit tests:** 53 passing (12 test files)

---

## 1. AI Layer (Backend)

### 1.1 Core Adapter Architecture (`lib/ai/`)

| File                  | Purpose                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/ai/types.ts`     | `AiAdapter` interface + `AiError` exception class. All adapters implement this.                                                                                                                                                                                                                                                                           |
| `lib/ai/adapter.ts`   | Factory `createAiAdapter()` that reads `AI_PROVIDER` env and instantiates the correct adapter. Supports `"ollama"`, `"openai"`, `"gemini"`, `"vertex"`.                                                                                                                                                                                                   |
| `lib/ai/ollama.ts`    | `OllamaAdapter` — native `fetch()` to `/api/chat`. Handles markdown code blocks, empty responses, connection errors.                                                                                                                                                                                                                                      |
| `lib/ai/openai.ts`    | `OpenAiAdapter` — native `fetch()` to `/v1/chat/completions`. Dormant until `OPENAI_API_KEY` is set.                                                                                                                                                                                                                                                      |
| `lib/ai/gemini.ts`    | `GeminiAdapter` — Google AI Studio API (`generativelanguage.googleapis.com`). Uses API key auth. Maps `"assistant"` → `"model"` role for Gemini API.                                                                                                                                                                                                      |
| `lib/ai/vertex.ts`    | `VertexAiAdapter` — GCP Vertex AI (`aiplatform.googleapis.com`). Uses OAuth 2 Bearer token from `gcloud auth print-access-token`. Token cached 50 min to avoid blocking event loop.                                                                                                                                                                       |
| `lib/ai/prompts.ts`   | System prompts + 6 few-shot examples for flow generation. Tuned for `gemini-2.5-flash` with explicit schema docs, exact `config` shapes, supported/unsupported patterns, and dummy address placeholders.                                                                                                                                                  |
| `lib/ai/normalize.ts` | Converts raw AI JSON → valid `FlowGraph` schema. Handles: `data`→`config` mapping, asset normalization, address sanitization (replaces invalid placeholders with valid dummy address), bps rebalancing (proportional normalization to 10,000), auto-adding missing recipients, auto-generating missing edges, structured error returns instead of throws. |

**Environment variables added:**

```bash
AI_PROVIDER=ollama|openai|gemini|vertex
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:3b
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
GCP_PROJECT_ID=gen-lang-client-0629431240
GCP_REGION=us-central1
VERTEX_MODEL=gemini-2.5-flash
```

### 1.2 Flow Generation API (`app/api/flows/generate/route.ts`)

- **POST** endpoint with auth + rate limit (5 req/min/user)
- Two-pass generation: primary prompt → retry with stricter prompt on failure
- JSON extraction from markdown code fences
- Structured error responses with **actionable guidance**:
  - `"The AI generated a flow with no trigger. Try saying 'When I receive...' in your prompt."`
  - `"Split percentages don't add up to 100%. Try rephrasing with exact percentages."`
- Returns `{ok: true, graph, english}` or `{ok: false, error, guidance}`

### 1.3 Smart Suggestions API (`app/api/flows/suggest/route.ts`)

- **POST** endpoint with auth + rate limit (10 req/min/user)
- Sends current flow graph to AI for review
- Returns `{suggestions: Array<{severity, message}>}`
- Gracefully degrades to empty array if AI is offline
- **Note:** UI panel temporarily hidden in builder for MVP simplicity; API remains intact

### 1.4 Schema & Validation Fixes (`lib/flows/schema.ts`, `app/api/flows/[id]/route.ts`)

**Problem:** The `FlowPatchSchema` inherited `FlowGraphSchema` which has `.min(2)` on nodes. This caused Zod to reject PATCH bodies with <2 nodes _before_ the route handler ran — breaking autosave when deleting nodes.

**Fix:**

- Added `FlowGraphPatchSchema` (no `.min(2)`) for PATCH saves
- `POST /api/flows` still uses strict `FlowGraphSchema` with `.min(2)`
- PATCH endpoint now saves incomplete graphs as-is; only updates `templateKind`/`parameters` when the graph IS valid (for deploy-time validation)

---

## 2. Frontend Layer

### 2.1 AI Generate Bar (`components/builder/ai-generate-bar.tsx`)

**Before:** Simple input + Generate button. Directly replaced canvas on success.

**After:** Guided preview/confirmation UX:

- User types prompt → clicks **Generate**
- Shows **AI Preview panel** with:
  - English description of the generated flow
  - Warning badges for placeholder addresses
  - **"Apply to Canvas"** button (user must confirm)
  - **"Cancel"** button
- On error: shows specific error message + actionable guidance + "Try Again"
- Loading state with spinner
- Quick-prompt chips were added then removed for cleaner UI

### 2.2 Builder Canvas (`components/builder/builder-client.tsx`)

**Major changes:**

1. **Dark mode node styling** — React Flow default nodes were white-on-white invisible in dark mode:
   - Node background: `#18181b` (zinc-900)
   - Node text: `#e4e4e7` (zinc-200)
   - Selected border: brand pink (`#fb7185`) with glow
   - Edge strokes: `#71717a` (zinc-500)
   - Background dots: `#27272a` (zinc-800)
   - Controls: dark themed

2. **Append instead of Replace** — `setGraph()` renamed to `appendGraph()`:
   - AI-generated flows are **added next to** existing flows
   - New nodes offset 200px to the right of the rightmost existing node
   - IDs remapped with `ai-` prefix + timestamp to avoid collisions
   - Existing flows stay intact

3. **Explicit autosave** — Replaced passive `useEffect` debounce with explicit `saveGraph()` calls inside every mutating function:
   - `addNode()` → saves immediately after placement
   - `updateNode()` → saves after config panel edit
   - `deleteNode()` → saves after removal
   - `appendGraph()` → saves after AI flow appended
   - Debounce shortened from 1500ms → 800ms
   - Fallback `useEffect` still handles drag/edge changes

4. **Suggestion panel** (temporarily hidden) — Dismissible severity cards (error/warning/info) with "Ask AI to Review" and "Re-review" buttons. Panel rendered in right sidebar below ConfigPanel.

### 2.3 Hydration Fix (`components/builder/suggestion-panel.tsx`)

- Fixed nested `<button>` HTML violation (Dismiss all button inside Toggle panel button)
- Changed outer toggle from `<button>` to `<div role="button">` with `cursor-pointer`

### 2.4 Autosave Error Silence

- Removed toast error spam for 422 validation failures during autosave
- Only shows toast for 5xx server errors
- 422s are silently ignored (graph is work-in-progress while editing)

---

## 3. Backend/API Layer

### 3.1 AI Provider Support

| Provider                  | Model                  | Auth                 | Status                          |
| ------------------------- | ---------------------- | -------------------- | ------------------------------- |
| Ollama (local)            | `qwen2.5:3b`           | None                 | Works, but slow on 8GB RAM      |
| OpenAI                    | `gpt-4o-mini`          | API key              | Wired, not tested (quota)       |
| Gemini (Google AI Studio) | `gemini-2.0-flash`     | API key              | Wired, free tier quota exceeded |
| **Vertex AI (GCP)**       | **`gemini-2.5-flash`** | **OAuth 2 / gcloud** | **✅ Active and working**       |

### 3.2 Database / API Changes

- `app/api/flows/[id]/route.ts` (PATCH): Now allows saving incomplete graphs. Validation deferred to deploy time.
- `lib/flows/schema.ts`: Added `FlowGraphPatchSchema` for lenient PATCH validation
- `lib/env.ts`: Added `GEMINI_API_KEY`, `GEMINI_MODEL`, `GCP_PROJECT_ID`, `GCP_REGION`, `VERTEX_MODEL` to Zod schema
- `.env.example` and `.env.local`: Documented all AI provider options

### 3.3 Rate Limiting

- `ai:generate:${userId}` — 5 requests / 60 seconds
- `ai:suggest:${userId}` — 10 requests / 60 seconds

---

## 4. Testing

### 4.1 Unit Tests Added (`tests/unit/ai/`)

| File                | Tests | Coverage                                                                                                                                          |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter.test.ts`   | 4     | Factory creates correct adapter for each provider                                                                                                 |
| `ollama.test.ts`    | 5     | Success, error, empty response, markdown extraction, invalid JSON                                                                                 |
| `openai.test.ts`    | 5     | Same patterns as Ollama                                                                                                                           |
| `gemini.test.ts`    | 5     | Success, role mapping, HTTP error, empty candidates, non-STOP finish                                                                              |
| `prompts.test.ts`   | 3     | System prompt presence, few-shot count, suggestion messages                                                                                       |
| `normalize.test.ts` | 11    | Splitter, streamer, XLM asset, custom asset, condition, edge IDs, config-vs-data, auto-edges, bps normalization, missing recipient, invalid input |
| `suggest.test.ts`   | 4     | Valid suggestion parsing, invalid severity rejection, empty message rejection, mixed valid/invalid filtering                                      |

**Total: 53 tests, all passing**

---

## 5. Known Issues & Limitations

1. **e2e tests:** `global-setup.ts` login timeout is pre-existing (unrelated to AI changes)
2. **Vertex AI auth:** Requires `gcloud auth login` on the demo machine; token expires ~1 hour
3. **AI-generated addresses:** All recipients use a dummy placeholder address. Users **must** replace them with real Stellar addresses before deploying.
4. **Suggestion panel:** Hidden from UI for MVP simplicity. API endpoint remains functional.
5. **Quick-prompt chips:** Removed from UI. Users type prompts manually.

---

## 6. Rollout Status

| Phase                 | Branch                  | Status                         |
| --------------------- | ----------------------- | ------------------------------ |
| 1. AI Adapter Layer   | `feat/ai-adapter-layer` | ✅ Complete                    |
| 2. NL Flow Generation | `feat/ai-adapter-layer` | ✅ Complete                    |
| 3. Smart Suggestions  | `feat/ai-adapter-layer` | ✅ Backend complete, UI hidden |
| 4. Polish & Demo UX   | `feat/ai-adapter-layer` | ✅ Complete                    |

**Ready for hackathon demo.** Recommended demo flow:

1. Open builder
2. Type: _"When I receive USDC, split 50% to Alice and 50% to Bob"_
3. Click **Generate** → see preview → click **Apply to Canvas**
4. Show dark-themed nodes on canvas
5. Drag nodes, add blocks from palette, delete — all autosave
6. Click **Deploy** (requires real addresses + Freighter wallet)

---

## 7. File Diff Summary (vs `origin/main`)

```
.env.example                            |  12 ++
PLAN.md                                 | 163 ++++++++++++++
SESSION.md                               | 186 +++++++++++++++
app/api/deployments/[id]/sep7/route.ts   |   4 +-
app/api/flows/[id]/route.ts              |  15 +-
app/api/flows/generate/route.ts         | 141 ++++++++++++
app/api/flows/suggest/route.ts          |  68 ++++++
app/dashboard/page.tsx                   |   6 +-
app/flows/[flowId]/page.tsx              |   6 +-
app/globals.css                          |  38 ++++
app/login/page.tsx                       |   3 +-
app/page.tsx                             |  20 +-
app/register/page.tsx                    |   4 +-
auth.config.ts                           |   8 +-
components/auth/register-form.tsx        |   2 +-
components/builder/ai-generate-bar.tsx   | 188 ++++++++++++++++
components/builder/builder-client.tsx    | 187 +++++++++++++---
components/builder/palette.tsx           |  11 +-
components/builder/suggestion-panel.tsx  | 133 +++++++++++
lib/ai/adapter.ts                        |  50 +++++
lib/ai/gemini.ts                         |  90 ++++++++
lib/ai/normalize.ts                      | 305 ++++++++++++++++++++++++++
lib/ai/ollama.ts                         |  67 ++++++
lib/ai/openai.ts                         |  74 +++++++
lib/ai/prompts.ts                        | 368 ++++++++++++++++++++++++++++++++
lib/ai/types.ts                          |  21 ++
lib/ai/vertex.ts                         | 126 +++++++++++
lib/env.ts                               |  24 ++-
lib/errors.ts                            |   4 +-
lib/flows/schema.ts                      |  12 +-
lib/flows/validate.ts                    |   3 +-
lib/stellar/scval.ts                     |  10 +-
prisma/seed.ts                           |   4 +-
scripts/upload-wasm.ts                   |   4 +-
tailwind.config.ts                       |   6 +-
tests/unit/ai/adapter.test.ts           |  49 +++++
tests/unit/ai/gemini.test.ts            | 103 +++++++++
tests/unit/ai/normalize.test.ts         | 279 +++++++++++++++++++++++
tests/unit/ai/ollama.test.ts            |  89 ++++++++
tests/unit/ai/openai.test.ts            |  89 ++++++++
tests/unit/ai/prompts.test.ts           |  44 ++++
tests/unit/ai/suggest.test.ts           |  48 +++++
tsconfig.json                             |   7 +-
```

---

_Generated by OpenCode AI Agent on 2026-05-13_
