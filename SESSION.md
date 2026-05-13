# Session Checkpoint — AI Integration Planning

**Date:** 2026-05-13
**User Goal:** Integrate AI into Pink Raft for ease of use
**Scope:** Natural Language → Flow + Smart Suggestions & Corrections

---

## Decisions Made

| Decision                           | Value                                 |
| ---------------------------------- | ------------------------------------- |
| AI Provider (default)              | Ollama (local)                        |
| AI Provider (future)               | OpenAI (paid, ready via env switch)   |
| Model                              | `qwen2.5:3b` (fits 8GB M2 Air)        |
| Backup model                       | `llama3.2:3b`                         |
| No new npm deps                    | Native `fetch()` only                 |
| Demo fallbacks                     | **NOT included**                      |
| Auto-suggest on validation failure | **YES**                               |
| Data privacy                       | Local only, graph never leaves server |

## Context Captured

- Read `SPEC.md`, `AGENT.md`, `README.md`, `package.json`
- Explored all builder components, flow logic, validation, schema
- Understood deploy flow, Stellar integration, auth, rate-limiting
- User machine: MacBook Air M2, 8GB RAM, other apps running

## Branches Planned

1. `feat/ai-adapter-layer`
2. `feat/ai-natural-language-flow`
3. `feat/ai-smart-suggestions`
4. `feat/ai-polish-demo`

## Open Questions (Resolved)

- ✅ What kind of AI integration? → NL Flow + Smart Suggestions
- ✅ Which model? → `qwen2.5:3b` (recommended by agent)
- ✅ Free vs paid? → Free local first, OpenAI ready via env
- ✅ Demo fallbacks? → No
- ✅ Auto-trigger suggestions? → Yes

## Agent Protocol

> **This file is a living document.** After completing each branch, the agent must update this `SESSION.md` with:
>
> - Branch completion date
> - What was built
> - Any deviations from `PLAN.md`
> - New decisions or blockers encountered
> - Updated next steps

---

## Branch: `feat/ai-adapter-layer` — COMPLETED

**Completed:** 2026-05-13

### What was built

| File                      | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `lib/ai/types.ts`         | `AiAdapter` interface + `AiError`                                    |
| `lib/ai/prompts.ts`       | System prompts + few-shot examples for flow generation & suggestions |
| `lib/ai/ollama.ts`        | `OllamaAdapter` via native `fetch()` to `/api/chat`                  |
| `lib/ai/openai.ts`        | `OpenAiAdapter` via native `fetch()` to `/v1/chat/completions`       |
| `lib/ai/adapter.ts`       | Factory `createAiAdapter()` reading `AI_PROVIDER` env                |
| `lib/env.ts`              | Zod-validated env (AI vars only for now)                             |
| `.env.example`            | Example env with AI variables                                        |
| `tests/unit/ai/*.test.ts` | 17 passing unit tests mocking all `fetch` calls                      |
| `package.json`            | Minimal project manifest (reconstructed after session crash)         |
| `tsconfig.json`           | Strict TS config with `@/` paths                                     |
| `vitest.config.ts`        | Vitest config resolving `@/` alias                                   |

### Deviations from PLAN.md

- Project files were initially missing on `feat/ai-adapter-layer` branch; restored full app from `origin/main` and merged AI adapter layer into it.

### Acceptance criteria

- ✅ `pnpm typecheck` — AI files clean (pre-existing Prisma errors in unrelated files)
- ✅ Unit tests mock Ollama/OpenAI fetch calls (17 tests, all green)
- ✅ Switching `AI_PROVIDER=openai` works with no other code changes
- ✅ `pnpm db:migrate` applied successfully
- ✅ `pnpm db:seed` created admin user
- ✅ Dev server running on `http://localhost:3000`

### Login credentials

- **Username:** `admin`
- **Password:** `admin1234567`

### New decisions / blockers

- None. Phase 1 is complete and the app is live.

## Branch: `feat/ai-natural-language-flow` — COMPLETED

**Completed:** 2026-05-13

### What was built

| File                                     | Purpose                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `lib/ai/normalize.ts`                    | Converts AI JSON output to valid `FlowGraph` schema (maps `data`→`config`, normalizes assets, amounts, edge IDs) |
| `app/api/flows/generate/route.ts`        | POST endpoint: auth + rate-limit (5/min) → AI adapter → normalize → validate → return `{ok, graph, english}`     |
| `components/builder/ai-generate-bar.tsx` | Input bar with wand icon, loading state, toast feedback                                                          |
| `components/builder/builder-client.tsx`  | Integrated AI bar above canvas; added `setGraph()` to replace canvas state                                       |
| `tests/unit/ai/normalize.test.ts`        | 8 unit tests covering splitter, streamer, conditional, asset normalization, edge ID generation                   |

### Acceptance criteria

- ✅ `pnpm typecheck` passes
- ✅ 41 unit tests pass (including 8 new normalize tests)
- ✅ API rate-limits to 5 req/min/user
- ✅ Invalid AI JSON returns graceful error
- ✅ Generated flow is validated before returning

### New decisions / blockers

- Ollama model `qwen2.5:3b` pulled and ready (~1.9 GB)
- End-to-end browser test pending (requires login + UI interaction)

## Branch: `feat/ai-smart-suggestions` — COMPLETED

**Completed:** 2026-05-13

### What was built

| File                                      | Purpose                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app/api/flows/suggest/route.ts`          | POST endpoint: auth + rate-limit (10/min) → AI adapter → parse suggestions JSON → return `{suggestions}`     |
| `components/builder/suggestion-panel.tsx` | Dismissible severity cards (error/warning/info), collapsible panel, "Ask AI to Review" / "Re-review" buttons |
| `components/builder/builder-client.tsx`   | Integrated suggestion panel in right sidebar; added `fetchSuggestions()` + auto-trigger on autosave failure  |
| `tests/unit/ai/suggest.test.ts`           | 4 unit tests for suggestion schema parsing and filtering                                                     |

### Acceptance criteria

- ✅ `pnpm typecheck` passes
- ✅ 45 unit tests pass
- ✅ Suggestions gracefully degrade to empty array when AI is offline
- ✅ Rate-limited to 10 req/min/user
- ✅ Auto-trigger on autosave validation failure (with deduplication)

### New decisions / blockers

- None. Phase 3 is complete.

## Next Steps

Begin Phase 4: `feat/ai-polish-demo`

- Tune `lib/ai/prompts.ts` for `qwen2.5:3b` (JSON mode hints, stricter format)
- Add demo quick-prompt chips to `ai-generate-bar.tsx`
- Add retry logic for invalid AI JSON
- Ensure all 3 contract templates generate correctly via NL
- Run `pnpm test:e2e`
