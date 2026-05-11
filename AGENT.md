# AGENT.md — Pink Raft Coding Agent Guide

> **Read this before you write a single line.** This document is the source of truth for the coding agent building Pink Raft. The product spec lives in `SPEC.md`. This file is about **how to build it well**.

---

## 0. Mental Model

You are building a **financial application that signs blockchain transactions**. Two consequences:

1. **Mistakes are not "bugs we'll fix later."** A mis-parameterized splitter sends real money to the wrong address. Validate twice (client + server), then validate again in the contract itself. Make incorrect states unrepresentable in the type system whenever possible.
2. **The user's keys are sacred.** Pink Raft is **non-custodial**. The backend may **build** and **submit** transactions, but **never** sees or stores a private key. If you find yourself adding a code path that handles `secretKey`, stop, re-read this paragraph, and rethink.

---

## 1. Tech Stack — pin to these versions

Use the **latest stable** in the major lines below. Don't introduce a substitute without good reason.

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS |
| Package manager | pnpm 10 (enforced via `packageManager` field) |
| Language | TypeScript 5.7, `strict: true`, `noUncheckedIndexedAccess: true` |
| Framework | Next.js 15 (App Router, Server Actions, React Server Components) |
| UI | React 19, Tailwind CSS 4, shadcn/ui (copy-in, not a dep), lucide-react, framer-motion |
| Canvas | @xyflow/react 12 |
| Client state | zustand (only for the builder canvas; everything else is server state) |
| Server state | @tanstack/react-query (only where SSE/SWR not appropriate) |
| Forms | react-hook-form + zod |
| ORM | Prisma 6, Postgres 16 |
| Auth | Auth.js v5 (Credentials provider + WebAuthn) |
| Hashing | argon2 (argon2id) |
| WebAuthn | @simplewebauthn/server + @simplewebauthn/browser |
| Cache / pub-sub / rate-limit | ioredis (Railway Redis) |
| Stellar | @stellar/stellar-sdk 13, @creit.tech/stellar-wallets-kit |
| Logging | pino (+ pino-pretty in dev) |
| Tests | vitest (unit), @playwright/test (e2e) |
| Lint/format | eslint (next config) + prettier (+ tailwind plugin) |

**Rule:** if a dep is not in `SPEC.md §2`, justify it in the PR description.

---

## 2. Project Conventions

### 2.1 Directory Layout
Follow the tree in `SPEC.md` Appendix A. In short:
- `app/` — routes only; thin. Pages delegate to functions in `lib/`.
- `components/` — UI; **no fetch, no DB**. Receive data via props or hooks.
- `lib/` — domain logic. **Pure where possible.** Side effects gated by single-purpose modules (`lib/db.ts`, `lib/redis.ts`, `lib/stellar/*`).
- `prisma/` — schema + seed.
- `contracts/` — Rust workspace; do not import from TS.
- `scripts/` — operational tooling (upload WASM, backfills); never imported at runtime.

### 2.2 Naming
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.
- React components: `PascalCase`; hooks: `useCamelCase`; Zod schemas: `XxxSchema` exporting both the schema and `z.infer<typeof XxxSchema>` as `Xxx`.
- Route handlers: one `route.ts` per endpoint; export named functions (`GET`, `POST`, ...).
- Server-only code starts with `import "server-only";` at the top.
- Client components: `"use client";` only when needed (interactivity, browser APIs).

### 2.3 TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- No `any`. Use `unknown` + narrow. Escape hatches must include a `// eslint-disable-next-line` with a one-line justification.
- Prefer `type` over `interface` for unions; either is fine for objects.
- Use branded types for sensitive primitives: `type StellarAccountId = string & { readonly __brand: "StellarAccountId" }`. Only `assertStellarAccountId` (which uses `StrKey.isValidEd25519PublicKey`) returns one.
- Money: `bigint` for stroops everywhere internal; strings at the wire boundary. **Never** `number`.

### 2.4 Imports
- Absolute imports via `@/*` (configured in `tsconfig.json`).
- Order: node built-ins → external → `@/lib` → `@/components` → relative. Enforced by `eslint-plugin-import` or `simple-import-sort`.

### 2.5 Comments
- Default to none. Names should explain *what*. Comments explain *why*.
- For non-obvious crypto / consensus / Soroban quirks: write the comment.

---

## 3. Next.js Patterns

### 3.1 Server vs Client
- Default to **Server Components**. Add `"use client"` only when you need state, effects, browser APIs, or third-party client-only libs (React Flow, wallet kit).
- Fetch data in Server Components or Route Handlers. **Do not** fetch from Client Components except for SSE / streaming UX.
- Use **Server Actions** for form submits whenever the result navigates or invalidates server data; use Route Handlers for JSON APIs consumed by the client SDK pattern (deploy flow needs JSON, not a redirect).

### 3.2 Data Access
- All DB access goes through `lib/db.ts`'s singleton Prisma client. Do `import { db } from "@/lib/db"`.
- Wrap related writes in `db.$transaction([...])` or interactive transactions when ordering matters.
- Never accept a `where` clause from user input. Build the `where` from validated fields.

### 3.3 Caching
- `fetch` with `cache: "no-store"` for anything user-specific.
- Use `revalidateTag(...)` after mutations; tag reads with `next: { tags: ["flow:" + id] }`.
- Soroban RPC responses are **never** cached at the framework layer.

### 3.4 Streaming / SSE
- SSE handlers return a `Response` constructed from a `ReadableStream`. Always:
  - Set `Content-Type: text/event-stream; charset=utf-8`.
  - Set `Cache-Control: no-cache, no-transform`.
  - Set `Connection: keep-alive` (when behind HTTP/1.1 proxy).
  - Implement an `AbortSignal` cleanup that unsubscribes Redis listeners.
- Heartbeat every 25s.

---

## 4. Authentication

- One canonical helper: `requireSession(opts?: { role?: Role })` in `lib/auth.ts`. Use it at the top of **every** non-public Route Handler and Server Action.
- `getSession()` is the nullable variant for pages that render different content for guests.
- Passwords hashed with argon2id; never log them; redact in Pino serializers.
- After successful login: rotate session ID, set `lastLoginAt`, write `AuditLog{ action: "USER_LOGIN" }`.
- After 5 failed attempts: `User.lockedUntil = now + 15min`. Return generic error.
- Passkey registration requires a fresh session and a recent password re-auth (last 5 min).

---

## 5. Validation

- One Zod schema per request body. Define in `lib/<feature>/schema.ts` and reuse on client (`react-hook-form` resolver) and server.
- Parse, don't validate: `const input = MySchema.parse(await req.json())`. Wrap in a try/catch that maps `ZodError → 422 { error: { code: "VALIDATION", fields } }`.
- Stellar primitives use dedicated parsers:
  - `parseStellarAccountId(s)` — uses `StrKey.isValidEd25519PublicKey`.
  - `parseStellarContractId(s)` — uses `StrKey.isValidContract`.
  - `parseStroopAmount(s)` — string → `bigint`, must be `>= 1n` and `<= 2^63-1`.
- Flow validation runs in `lib/flows/validate.ts`:
  - Zod schema for shape.
  - DAG check (no cycles).
  - Exactly one trigger root.
  - Splitter recipients sum to 10_000 bps.
  - Used by `/api/flows/:id/validate` and again inside `/api/deployments/prepare`.

---

## 6. Stellar / Soroban

### 6.1 Clients
- Two singletons in `lib/stellar/client.ts`:
  - `horizon` — `new Horizon.Server(env.STELLAR_HORIZON_URL)`.
  - `rpc` — `new rpc.Server(env.STELLAR_SOROBAN_RPC_URL, { allowHttp: false })`.
- All RPC calls live in `lib/stellar/*`. No component imports `@stellar/stellar-sdk` directly.

### 6.2 Building Transactions
- Always `simulateTransaction` before returning XDR to the client; persist the simulated `minResourceFee` and use `assembleTransaction(tx, sim)`.
- Set explicit fees and timeouts: `setTimeout(180)`, never `TimeoutInfinite`.
- Use the user's account as `source`. Pink Raft never has its own funded operational account.

### 6.3 Submitting
- After client returns signed XDR:
  - Re-parse and assert the inner operations match what we built (defense vs swapped XDR).
  - `rpc.sendTransaction(envelope)` → poll `getTransaction` until `SUCCESS|FAILED`, max 30s.
  - On `SUCCESS`, extract the new contract address from the meta and persist.

### 6.4 Reading Events
- Use `rpc.getEvents({ startLedger, filters: [{ type: "contract", contractIds: [...] }] })`.
- Decode using stored ABI; do not trust event topic order.
- Idempotency on `(txHash, kind)` unique.

### 6.5 Networks
- Never read network passphrase from runtime config of the wallet; the server is the source of truth.
- Mainnet is gated by `ENABLE_MAINNET=true`. Default deny.

---

## 7. Smart Contract Templates (Rust)

You will rarely modify these. When you do:
- Treat any change as a **breaking ABI change** unless proven otherwise. Bump the in-contract `version` symbol.
- Use `i128` and checked math. `unwrap()` is allowed only on values the contract itself produced.
- Every state-mutating call requires `caller.require_auth()`.
- Re-upload WASM and re-seed `ContractTemplate.wasmHash` for every network when ABI changes.
- Run `stellar contract optimize` before uploading.

---

## 8. Database (Prisma)

- Migrations are mandatory: `pnpm db:migrate` in dev, `prisma migrate deploy` in CI.
- Never edit a migration after it's been merged to `main`; create a new one.
- Indexes: add an `@@index` for any non-PK column used in `WHERE` or `ORDER BY` for list endpoints.
- Soft-delete: not used. Cascades are explicit (see schema).
- Don't expose Prisma errors to clients. Map `P2002 → CONFLICT`, `P2025 → NOT_FOUND`, otherwise `INTERNAL`.

---

## 9. Security Checklist (per PR)

Before opening a PR, **walk through this list**. The reviewer will too.

- [ ] All new request bodies parsed with Zod.
- [ ] All new mutating endpoints call `requireSession()` and check ownership.
- [ ] No secret read from `process.env` outside `lib/env.ts`.
- [ ] No `dangerouslySetInnerHTML` introduced.
- [ ] No raw SQL except via `safeRaw` tagged template.
- [ ] No new dependency without `pnpm audit` clean.
- [ ] Cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] Security headers untouched or improved (see `next.config.ts`).
- [ ] `AuditLog` written for any new sensitive action.
- [ ] Rate-limit applied to new auth or write endpoints.
- [ ] PII/secret keys never logged (verify Pino redact list).
- [ ] CSP `connect-src` allows only the hosts you actually need.
- [ ] If touching contracts: re-uploaded WASMs and updated env hashes documented.

---

## 10. Performance Guidelines

- Avoid `SELECT *` via Prisma `select`/`include` shaping for any endpoint that returns lists.
- Page sizes default 20, max 100.
- N+1 in API → use `findMany({ include })`. In Server Components → use a single query.
- For the live feed: prefer Redis pub/sub over Postgres LISTEN/NOTIFY (multi-instance friendly).
- Avoid client bundles >250 KB gzipped per route. React Flow is heavy; lazy-load the canvas with `dynamic(() => import(...), { ssr: false })`.
- Use `next/image` for images; don't ship a `<img>` tag.

---

## 11. Testing

### 11.1 Unit (vitest)
Mandatory for:
- `lib/flows/validate.ts`, `lib/flows/to-params.ts`, `lib/flows/english.ts` — pure, high-leverage.
- `lib/stellar/deploy.ts` (mock the RPC client).
- `lib/auth.ts` helpers.
- All Zod schemas — round-trip a few realistic and adversarial inputs.

### 11.2 E2E (Playwright)
At least one happy-path scenario per network:
1. Login as seeded admin.
2. Create a Splitter flow with three recipients (test keypairs).
3. Click Deploy; intercept the wallet sign step with a mock that returns a pre-signed XDR (test-mode injection).
4. Assert deployment becomes CONFIRMED and contract address is shown.
5. Friendbot the contract; assert event feed shows a RECEIVE then three PAYOUTs within 30s.

### 11.3 Contract Tests
Soroban contracts have their own Rust tests under each contract crate (`#[test]` using `soroban-sdk`'s test env). CI runs `cargo test` for the workspace.

### 11.4 CI
- Lint, typecheck, unit, contract tests on every PR.
- E2E on PRs labeled `e2e` and on `main`.

---

## 12. Errors & Logging

- Throw `AppError` from `lib/errors.ts`: `new AppError("VALIDATION", "human msg", { fields })`.
- Route Handlers wrap their body in `withErrorHandler(...)` which maps `AppError` → status code and shape.
- Never `console.log`; use `log.info({ ...ctx }, "message")`. `log` is the Pino root from `lib/log.ts`.
- Required redacted keys: `req.headers.cookie`, `req.headers.authorization`, `*.password`, `*.passwordHash`, `*.signedXdr`, `*.secretKey`.

---

## 13. Env Vars

- All env access goes through `lib/env.ts` which exports a `z.object({...}).parse(process.env)` result.
- Adding a new var:
  1. Add to `lib/env.ts` with the right type and default policy.
  2. Add to `.env.example`.
  3. Document in `SPEC.md §12` and/or `§14.2`.
  4. Add to Railway "Variables" before merging.

---

## 14. Frontend UX Rules

- Forms always show field-level errors from server (`error.fields`) **and** client (Zod resolver).
- All async actions show optimistic state, a toast on success, and an inline error on failure.
- The Builder canvas is **keyboard accessible**: arrow keys move selected node, Delete removes it, Enter opens config panel.
- Hit `prefers-reduced-motion: reduce` and disable arrow animations.
- Color contrast ≥ AA. Dark mode supported.

---

## 15. Money / Demo Safety

- Default network = `testnet`. Every screen that submits a tx shows a "Testnet" badge.
- Mainnet writes are blocked unless:
  - `ENABLE_MAINNET=true`,
  - the user's `User.id` is in the `MAINNET_ALLOWLIST` env (CSV),
  - the user types "I understand" in a confirm dialog.

---

## 16. Working with the Agent (Process)

When the coding agent picks up a task:

1. **Read the relevant section of `SPEC.md` first.** Quote the section in the PR description.
2. **Plan in three bullets**: what files change, what schema migrates, what tests are added.
3. **Make incorrect states unrepresentable.** Use Zod, branded types, exhaustive `switch` with `never` checks.
4. **One concern per PR.** A schema change and a UI change are two PRs unless coupled.
5. **No `TODO:` comments without a tracking issue link.**
6. **Self-review with §9 checklist** before requesting human review.

---

## 17. Quick Reference — Forbidden Patterns

> If you write any of these, the diff will be rejected.

- ❌ Holding or transmitting Stellar `secretKey` anywhere on the server.
- ❌ `process.env.X` outside `lib/env.ts`.
- ❌ `JSON.parse(request.body)` without a Zod schema.
- ❌ `eval`, `new Function`, `dangerouslySetInnerHTML` (outside vetted MDX pipeline).
- ❌ `prisma.$queryRawUnsafe` with interpolated user input.
- ❌ Storing money as `number`.
- ❌ Logging cookies, tokens, or raw request bodies.
- ❌ `fetch(url)` to a user-supplied URL without an allowlist (SSRF).
- ❌ Disabling TypeScript with `// @ts-ignore` (use `// @ts-expect-error` with a reason and a link).
- ❌ Committing `.env*` files other than `.env.example`.
- ❌ Skipping migrations by editing the live DB.
- ❌ Adding a dep without justification + `pnpm audit` clean.

---

## 18. Glossary

- **Soroban** — Stellar's smart contract platform.
- **SAC** — Stellar Asset Contract; the Soroban interface to a classic Stellar asset (e.g., USDC).
- **WASM hash** — content hash of an uploaded contract binary; multiple contract instances share one hash.
- **Footprint** — the read/write set declared in a Soroban tx; required for the network to schedule it.
- **SEP-7** — Stellar payment URI scheme (`web+stellar:pay?...`).
- **stroop** — 1e-7 of an XLM (and the canonical integer unit for Stellar amounts).

---

*If anything in this file conflicts with `SPEC.md`, `SPEC.md` wins for **what** to build; this file wins for **how** to build it. If they conflict on a security topic, the **stricter** rule wins. When in doubt: stop and ask.*

