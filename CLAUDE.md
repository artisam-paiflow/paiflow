# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This is the single guide for working in this repo.
> `SPEC.md` is the product spec — the authority on _what_ to build; this file is the authority on
> _how_. On a security question, the **stricter** rule wins. `SPEC.md` deliberately does not restate
> implementation, so for the current shape of the code read the code. When in doubt: stop and ask.

---

## 0. Mental model

You are building a **financial application that signs blockchain transactions**. Two consequences:

1. **Mistakes are not "bugs we'll fix later."** A mis-parameterized splitter sends real money to the
   wrong address. Validate twice (client + server), then again in the contract itself. Make
   incorrect states unrepresentable in the type system whenever possible.
2. **The user's keys are sacred.** Paiflow is **non-custodial**. The backend may **build** and
   **submit** transactions but never sees or stores a user's private key. If you find yourself
   adding a code path that handles a user `secretKey`, stop and rethink. (The one server-held key is
   Paiflow's own relayer — see [§2](#2-architecture).)

---

## 1. Commands

```bash
pnpm install                 # Node 22.22.x, pnpm 10.4.1 (corepack)
pnpm docker:up               # Postgres + Redis + MinIO (profile "full"; "core" omits MinIO)
pnpm db:migrate              # create + apply a migration (dev)
pnpm db:seed                 # requires ADMIN_SEED_PASSWORD (>=12 chars); refuses to use a default
pnpm dev
```

| Task                                      | Command                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Typecheck                                 | `pnpm typecheck`                                                                   |
| Lint                                      | `pnpm lint` (see [§19](#19-known-gaps--rules-not-enforced-yet) before trusting it) |
| Format                                    | `pnpm format`                                                                      |
| Unit tests                                | `pnpm test`                                                                        |
| **One unit test file**                    | `pnpm test tests/unit/offramp/pdax.test.ts`                                        |
| **One unit test by name**                 | `pnpm test -- -t "<test name substring>"`                                          |
| **One component test file**               | `pnpm test tests/unit/builder/inputs/smoke.test.tsx`                               |
| Component tests only                      | `pnpm test --project dom`                                                          |
| As CI runs it (junit to `reports/`)       | `pnpm test:ci`                                                                     |
| Watch                                     | `pnpm test:watch`                                                                  |
| E2E (boots `pnpm dev` itself)             | `pnpm test:e2e`                                                                    |
| **One E2E spec**                          | `pnpm test:e2e tests/e2e/happy-path.spec.ts`                                       |
| Screenshots (committed to `screenshots/`) | `pnpm screenshots` / `pnpm screenshots:mobile`                                     |

Vitest runs two projects: `node` picks up `tests/unit/**/*.test.ts`, `dom` picks up
`tests/unit/**/*.test.tsx` under jsdom (plus `tests/unit/setup-dom.ts`), and a file matching
neither is skipped without a warning, which `tests/unit/test-config.test.ts` guards against.
`vitest.config.ts` aliases `server-only` and `dotenv` to stubs in `tests/stubs/` — **there is no
`@/lib/env` stub; code under test gets the real schema.** Isolation comes from `tests/unit/setup.ts`
instead: before each test **file** it deletes
every variable `EnvSchema` knows (`ENV_VAR_NAMES`), then sets `AUTH_SECRET`, pins `NODE_ENV=test`
(vitest only does `??=`, so a shell `production` would otherwise leak), and puts back `DATABASE_URL`
and `LOG_LEVEL` from your shell — falling back to the local Postgres and `silent` — so you can still
point the suite's `deleteMany()` wipes at a scratch DB or turn logging up. No other
**schema-backed** variable reaches the suite from your shell; the `process.env` reads that bypass
`lib/env.ts` ([§19](#19-known-gaps--rules-not-enforced-yet)) are not covered. Nothing re-scrubs
between cases in a file, so a test that mutates `process.env` cleans up after itself; one that
needs a specific value sets it and calls `vi.resetModules()` to clear `env()`'s memoized parse.
Playwright reuses an existing dev server if one is up and needs `tests/e2e/.auth/admin.json` from
its global setup.

Contracts (Rust workspace, not built by the Node build):

```bash
pnpm contracts:deploy:testnet   # build → upload → deploy-factory → update-hashes
cd contracts && cargo test --workspace && cargo clippy --all-targets -- -D warnings
```

CI (`.github/workflows/ci.yml`): a **node** lane (`db:generate` → `db:migrate:deploy` → `typecheck`
→ `test:ci`, which uploads the `vitest-junit` artifact and a job summary → `db:seed` → `build` →
`pnpm audit`) and a **rust** lane (`cargo fmt --check`, `clippy -D warnings`,
`cargo test --workspace`). Both must be green. **There is no E2E job.**

The stack table and directory tree live in
[`README.md` → "Stack at a glance"](README.md#stack-at-a-glance) and
[→ "Project layout"](README.md#project-layout) — the single source of truth, not repeated here.
Before adding a dependency: justify it in the PR description, keep `pnpm audit` clean, and check the
"things people expect to find and won't" list under that table. This repo deliberately has **no**
component library, **no** client-state library, and **no** Server Actions. Adding one is an
architectural change, not a convenience — raise it first.

---

## 2. Architecture

### The central object is a flow graph, not a contract

A `Flow` row stores a JSON `graph` (nodes + edges) authored on an `@xyflow/react` canvas. Every
downstream step is a transformation of that graph:

```
Flow.graph (JSON)
  → lib/flows/schema.ts        Zod shape; also the client-side resolver
  → lib/flows/validate.ts      DAG check, single trigger root, splitter bps sum, pending addresses
  → lib/flows/to-params.ts     flowToPipeline() → PipelineNode[] (one node = one contract + ctor args)
  → lib/stellar/deploy.ts      preparePipelineDeployTx() → unsigned XDR
  → user's wallet signs
  → /api/deployments/[id]/submit → factory deploy_pipeline → Deployment.pipelineSnapshot
```

`pipelineSnapshot` is the durable map of `nodeId → contractAddress → templateKind`. Anything that
needs to talk to a deployed contract (event polling, live balances, dev-mode mutation, relayer
charges) resolves through it via `lib/flows/pipeline-snapshot.ts`, **not** by re-deriving from the
graph. `lib/flows/english.ts` renders the same graph as prose for the builder's preview pane.

### Deploys go through a factory, atomically

The app does **not** instantiate contracts one at a time. WASM is uploaded once per network; a
`factory` contract then deploys an entire pipeline in a single `deploy_pipeline` invocation, with
child addresses pre-computed from deterministic salts (CAP-46). The wiring itself is TypeScript-side:
each child's address is computed before the call and passed to its neighbours as a constructor
argument, so one transaction lands a fully-connected pipeline.

The factory is **kind-agnostic** — `contracts/factory/src/lib.rs` is 37 lines, takes
`NodeBlueprint { wasm_hash, constructor_args }`, and knows nothing about node types. Adding a node
type means a new contract crate plus `to-params.ts`, `scval.ts`, the `TemplateKind` enum, and
`scripts/update-hashes.ts` — **not** the factory. See `docs/soroban-smart-contracts.md` §5.

### The one server-held key is the relayer

`STELLAR_RELAYER_SECRET_KEY` is Paiflow's own key, used in `lib/stellar/relayer.ts` and
`lib/stellar/dev-mutate.ts` to sign `*_by_relayer` contract calls so scheduled charges and claims
run without the user signing each time. Contracts enforce dual auth (admin **or** relayer).

Relayer submissions are serialized through `withRelayerLock()` in `lib/stellar/client.ts` to avoid
`txBadSeq` from concurrent sequence-number use. **That lock is in-process only** — a multi-replica
deployment or a separate cron process can still race it. `sorobanRpc()` also validates at startup
that the relayer's sequence number hasn't exceeded `MAX_SAFE_INTEGER`.

### Config resolves env → DB; network is pinned per environment

`env()` is a **lazy function**, not an object: `import { env } from "@/lib/env"` then `env().FOO`.
`STELLAR_NETWORK` selects which `*_TESTNET` / `*_MAINNET` variables the helpers in `lib/env.ts`
(`stellarRpcUrl`, `stellarPassphrase`, `stellarWasmHash`, …) return — see [§7.5](#75-networks).

WASM hashes and the factory address resolve through `lib/stellar/config.ts`, which reads the
`ContractTemplate` / `FactoryDeployment` **tables** first and falls back to env. `pnpm
contracts:update-hashes` copies `.env.local` values into those tables. Locally, uploading alone is
enough — `.env.local` _is_ the app's environment, so the fallback picks the new hash up. Anywhere
else it isn't: the upload writes to the operator's machine, not the deployed service. Note
`update-hashes` has no `--network` flag; it reads `STELLAR_NETWORK`, so it will happily sync testnet
hashes after a mainnet upload. See [`docs/mainnet-cutover.md`](docs/mainnet-cutover.md).

### Events: cron poll → Postgres → Redis → SSE

`/api/cron/poll-events` (guarded by an `x-cron-secret` header) pulls Soroban events for confirmed
deployments, writes `ContractEvent` rows, and publishes to a Redis channel.
`/api/deployments/[id]/events` is the only SSE handler: it replays recent rows, subscribes to Redis,
heartbeats with `: ping`, and unsubscribes on abort. The other `cron/*` routes drive the automation:
`auto-charge-payroll`, `auto-charge-subscriptions`, `auto-release`, `finalize-deployments`,
`process-offramp-jobs`, `process-streamer-jobs`.

### Fiat off-ramp is a job queue

Payouts marked as fiat create `OffRampPayoutJob` rows that walk
`PENDING → RUNNING → QUOTED → INITIATED → COMPLETED | FAILED | CANCELLED`, driven by
`cron/process-offramp-jobs` against `lib/offramp/provider.ts`. The default provider is a **mock**;
`OFFRAMP_PROVIDER=pdax` switches to the real PDAX Institution API, with credentials stored in the DB
via `/admin/offramp` (env vars are a fallback). See `docs/pdax-institution-api.md`, including the
UAT asset/bank constraints.

### Dev mode

A per-flow `devMode` flag on the graph swaps nodes that have a `_DEV` counterpart (`splitter_dev`,
`payer_dev`, `subscription_dev`, `cash_out_dev`) for on-chain-mutable variants. Values left blank at
design time are filled after deploy through the `/api/deployments/[id]/dev-*` routes, authenticated
by a `DevApiToken` rather than a session. Background in `docs/design/2026-06-24-dev-mode-mutable-flows.md`.

### Sandbox sessions

With `SANDBOX_ENABLED=true` (testnet only — `env()` refuses the flag under
`STELLAR_NETWORK=mainnet`) the login page offers "Try the sandbox". `POST /api/auth/sandbox`
mints a disposable `SANDBOX`-role user whose stored password is a sentinel that can never verify,
and signs it in through the same single-use ticket handshake the passkey login uses.
`lib/sandbox-paths.ts` is the **allowlist** of what that role may reach, checked in
`middleware.ts` ahead of `PUBLIC_PATHS` so the machine-auth endpoints listed there stay closed.
`SANDBOX_TEMPLATE_KINDS` in `lib/sandbox.ts` is enforced against **every node** of the generated
pipeline in `/api/deployments/prepare`: a sandbox session may only deploy pipelines the visitor's
own wallet signs end to end, never one the relayer later acts on.

Nothing deletes a sandbox user or what it deployed, and the account cannot be re-entered once its
cookie is gone, so the crons bound the work instead: `cron/poll-events` polls a sandbox-owned
deployment only for `SANDBOX_POLL_WINDOW_MS` after creation (`cronPollableDeploymentWhere()` in
`lib/sandbox.ts`), and `cron/auto-release` never loads one. The rows and the event cursor stay, and
the deployment page, its SSE stream and `tx-status` still ingest on demand.

### Partner API: `/api/v1`

`/api/v1` is the partner-facing surface: machine callers authenticated by a
`DeploymentApiToken` bound to exactly one deployment ([§5](#5-authentication)). It is separate from
the older payroll and `dev-*` machine routes, which keep their `requireDevAuth` ladder.

---

## 3. Project conventions

### 3.1 Directory layout

- `app/` — routes. Delegate real work to `lib/`.
- `components/` — UI. **No DB access, ever** (no `@/lib/db`, no Prisma client). Server components
  receive data via props; client components `fetch` their own `/api/*` route handlers. Type-only
  imports are fine, from `lib/` and from `@prisma/client` alike —
  `import type { TemplateKind } from "@prisma/client"` is the right way to type a prop.
- `lib/` — domain logic. **Pure where possible.** Side effects gated by single-purpose modules
  (`lib/db.ts`, `lib/redis.ts`, `lib/stellar/*`).
- `prisma/` — schema + seed. `contracts/` — Rust workspace; do not import from TS.
- `scripts/` — operational tooling (upload WASM, backfills); never imported at runtime.
- `homepage/` — the static marketing site (its own Railway service). Plain HTML, no build, nothing
  imported from the app. `styles.css` is generated by `pnpm homepage:css`; don't hand-edit it.

### 3.2 Naming

- Files: **`kebab-case` throughout** — `kebab-case.ts` for modules and `kebab-case.tsx` for React
  components. The filename never encodes the exported symbol's casing.
- Exported identifiers: React components `PascalCase`; hooks `useCamelCase`; Zod schemas
  `XxxSchema`, exporting both the schema and `z.infer<typeof XxxSchema>` as `Xxx`.
- Route handlers: one `route.ts` per endpoint; export named functions (`GET`, `POST`, …).
- Server-only code starts with `import "server-only";`.
- Client components: `"use client";` only when needed (interactivity, browser APIs).

### 3.3 TypeScript

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`. `exactOptionalPropertyTypes` is
  deliberately **off**; `tsconfig.json` is the source of truth for compiler flags, not this list.
- No `any`. Use `unknown` + narrow. Escape hatches need an `// eslint-disable-next-line` with a
  one-line justification. (Not currently enforced — [§19](#19-known-gaps--rules-not-enforced-yet).)
- Prefer `type` over `interface` for unions; either is fine for objects.
- Money: stroops are **`string`** in domain types, Zod schemas, and the DB (`amountStroops`,
  `amountPerPeriodStroops`, …). Convert to `bigint` for arithmetic and ScVal encoding, then back to
  `string` at the boundary. **Never `number`** — a float silently loses precision at 7 decimal
  places, exactly the resolution a stroop encodes.

### 3.4 Imports

- Absolute imports via `@/*`.
- Order: node built-ins → external → `@/lib` → `@/components` → relative. Convention only; no lint
  plugin enforces it ([§19](#19-known-gaps--rules-not-enforced-yet)).

### 3.5 Comments

- Default to none. Names explain _what_; comments explain _why_.
- For non-obvious crypto / Soroban quirks: write the comment.

---

## 4. Next.js patterns

### 4.1 Server vs client

- Default to **Server Components**. Add `"use client"` only for state, effects, browser APIs, or
  client-only libs (React Flow, wallet kit).
- Prefer fetching in Server Components. Client components **may** `fetch` their own `/api/*` route
  handlers — the dominant pattern here for forms, admin tables, and live panels. The boundary they
  must not cross is reaching past the API into `lib/db` or a server-only module.
- **This app has no Server Actions.** Every mutation is a Route Handler under `app/api/`, wrapped in
  `withErrorHandler`. Owner-scoped routes guard with `requireSession()` ([§5](#5-authentication));
  cron, webhook, and public trigger routes carry their own guards. Writing the first `"use server"`
  is an architectural change — raise it before you write it.

### 4.2 Data access

- Import `{ db } from "@/lib/db"` (98 files under `app/`, `lib/`, `components/` do; ~110 counting
  `tests/` and `scripts/`). `lib/db.ts` is a thin `server-only` re-export; the
  Prisma singleton itself lives in `lib/prisma.ts`. Don't add a second client.
- Wrap related writes in `db.$transaction([...])` or an interactive transaction when order matters.
- Never accept a `where` clause from user input. Build it from validated fields.

### 4.3 Caching

- **No framework-level caching is in use.** No `revalidateTag`, no tag-based revalidation, no
  explicit `cache:` option anywhere — Next 15 leaves `fetch` uncached by default, which is what this
  app wants.
- Freshness after a mutation comes from re-rendering the Server Component or from the polling hooks
  in `lib/hooks/`. Don't introduce the tag cache for a single endpoint; it's all-or-nothing.
- Soroban RPC responses are **never** cached at the framework layer. Deliberate caching that does
  exist is explicit and in-app: `lib/contract-read-cache.ts`.

### 4.4 Streaming / SSE

SSE handlers return a `Response` built from a `ReadableStream`, and always set
`Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection:
keep-alive`, plus an `AbortSignal` cleanup that unsubscribes Redis listeners. Heartbeat every 25s.
`app/api/deployments/[id]/events/route.ts` is the reference implementation.

---

## 5. Authentication

- One canonical helper: `requireSession(opts?: { role?: Role })` in `lib/auth.ts`. Use it at the top
  of every owner- or admin-scoped Route Handler.
- `getSessionUser()` is the nullable variant for pages that render differently for guests.
- Sessions are stateless JWTs, so a session is ended by incrementing `User.sessionVersion`, never
  by deleting `Session` rows (that table is always empty). `getSessionUser()` reads the row on
  every request and returns `null` when it is missing, inactive, or its version differs from the
  token's (`lib/auth/session-version.ts`); the role it returns is the row's, not the token's.
  Anything that should sign a user out — deactivate, password change or reset, role change,
  revoke-all — bumps the column in the same `update`.
- `page.tsx` uses `requirePageSession()`, not `requireSession()`. Middleware verifies only the
  JWT, so an ended session still reaches the page; the page guard redirects it to
  `GET /api/auth/stale-session`, which clears the cookie and lands on `/login`.
- Passwords hashed with argon2id; never logged; redacted in Pino serializers.
- After successful login: rotate session ID, set `lastLoginAt`, write `AuditLog{ action: "USER_LOGIN" }`.
- After 5 failed attempts: `User.lockedUntil = now + 15min`. Return a generic error.
- `Role.SANDBOX` is a real, disposable user anyone on the internet can mint. `requireSession()`
  accepts it like any role, so a route is closed to it only by the allowlist in
  `lib/sandbox-paths.ts`; add new routes there deliberately, and never add a relayer-signed
  template kind to `SANDBOX_TEMPLATE_KINDS` ([§2](#2-architecture), "Sandbox sessions").
- `/api/cron/*` guards with `requireCronSecret(req)` (`lib/auth/cron-secret.ts`, re-exported from
  `lib/auth.ts`), never `requireSession()`. It fails **closed**: under `NODE_ENV=production` an
  unset or shorter-than-32-char `CRON_SECRET` refuses every request and logs once, rather than
  refusing to boot — these routes are public in `middleware.ts` and several sign with the relayer
  key. Off production an unset secret still leaves them open, which is what local dev wants.
- Compare a secret presented in a request with `timingSafeEqualString()`
  (`lib/auth/timing-safe.ts`), never `===`. It is the one copy; don't hand-roll another.
- Passkey registration currently requires only an authenticated session (`requireSession()` in
  `app/api/auth/passkey/register/options/route.ts`). It does **not** re-verify the password, so
  adding a second credential is as easy as holding a live session — see [§19](#19-known-gaps--rules-not-enforced-yet).
- `/api/v1/deployments/:id/*` handlers are written as `v1Route({ rateLimit }, fn)`
  (`lib/api/v1/handler.ts`), never with `requireSession()` or `requireDevAuth()`. The wrapper
  applies `withErrorHandler`, a UUID check on `id`, `requireDeploymentToken()`
  (`lib/api/v1/auth.ts`: `Authorization: Bearer pfk_…` only, one generic `UNAUTHENTICATED` for
  every refusal), and a rate limit keyed on the token id rather than the IP. `middleware.ts` lists
  `/api/v1` in `PUBLIC_PATHS`, so the wrapper is the only guard; a sandbox session is kept out by
  `lib/sandbox-paths.ts`. Tokens are hashed with `hashApiToken()` (`lib/auth/api-token.ts`), shared
  with `requireDevApiToken()`.

---

## 6. Validation

- One Zod schema per request body. Define in `lib/<feature>/schema.ts` and reuse on the client
  (`react-hook-form` resolver) and the server.
- Parse, don't validate: `const input = MySchema.parse(await req.json())`. `withErrorHandler` maps
  `ZodError → 422 { error: { code: "VALIDATION", fields } }`.
- Stellar primitives: validate with `StrKey.isValidEd25519PublicKey` / `StrKey.isValidContract`,
  today via inline Zod `.refine(...)` at each boundary. `lib/stellar/strkey.ts` holds branded types
  and parsers for this but is **not yet adopted** ([§19](#19-known-gaps--rules-not-enforced-yet)).
- Flow validation lives in `lib/flows/validate.ts`: Zod shape, DAG check (no cycles), exactly one
  trigger root, splitter recipients summing to 10_000 bps, and pending-address collection. Called by
  `/api/flows/:id/validate` and again inside `/api/deployments/prepare`.

---

## 7. Stellar / Soroban

### 7.1 Clients

- `sorobanRpc()` and `horizon()` in `lib/stellar/client.ts` are lazy, globally memoized **functions**
  (not exported consts). URLs come from `stellarRpcUrl()` / `stellarHorizonUrl()`; both reject
  plaintext HTTP.
- All RPC calls live in `lib/stellar/*`. No component imports `@stellar/stellar-sdk` directly.

### 7.2 Building transactions

- Always `simulateTransaction` before returning XDR to the client; use `rpc.assembleTransaction(tx, sim).build()`.
- Set explicit fees and timeouts: `setTimeout(180)`, never `TimeoutInfinite`.
- Use the user's account as `source` for user-initiated deploys.

### 7.3 Submitting

- `rpc.sendTransaction(envelope)` → poll `getTransaction` until `SUCCESS|FAILED`, max 30s.
- On `SUCCESS`, extract the contract addresses from the result meta and persist them as
  `pipelineSnapshot`.
- Submission is idempotent on the tx hash recomputed from the signed XDR.
- **Intended but not implemented:** re-parsing the signed XDR and asserting its inner operations
  match what we built ([§19](#19-known-gaps--rules-not-enforced-yet)).

### 7.4 Reading events

- `rpc.getEvents({ startLedger, filters: [{ type: "contract", contractIds: [...] }] })`.
- Decoding is hand-rolled in `lib/stellar/events.ts` — do not trust event topic order.
  (`ContractTemplate.abiJson` is stored but never read.)
- Idempotency is the `ContractEvent.eventId` unique constraint, **not** `(txHash, kind)`.

### 7.5 Networks

**Canonical statement of the network model. Don't restate it elsewhere — link here.**

- Never read the network passphrase from the wallet's runtime config; the server is the source of truth.
- The active network is pinned per environment via `STELLAR_NETWORK` (local/staging = `testnet`,
  production = `mainnet`). There is **no** per-deploy picker, **no** `ENABLE_MAINNET` flag, and
  **no** `MAINNET_ALLOWLIST`. Authorization for _who can deploy_ is the auth system's job; _which
  network_ is collapsed into the environment.
- Mainnet writes happen only because the production Railway service has `STELLAR_NETWORK=mainnet`.
  No in-app override, no per-user allowlist, no "I understand" confirmation. **The kill switch is
  scaling the prod service to zero.**
- Runbook: [`docs/mainnet-cutover.md`](docs/mainnet-cutover.md).

---

## 8. Smart contract templates (Rust)

You will rarely modify these. When you do:

- Treat any change as a **breaking ABI change** unless proven otherwise.
- Use `i128` and checked math. `unwrap()` only on values the contract itself produced.
- Every state-mutating call requires `require_auth()` on the authorizing address.
- Re-upload WASM and re-run `pnpm contracts:update-hashes` for every network when the ABI changes.
- The size/safety `[profile.release]` is declared once on the workspace — don't add one per crate.
- Full pipeline and "how to add a contract": `docs/soroban-smart-contracts.md` §4.2–4.3 and §5.

---

## 9. Database (Prisma)

- Migrations are mandatory: `pnpm db:migrate` in dev, `prisma migrate deploy` in CI/prod.
- Never edit a merged migration; create a new one.
- Add an `@@index` for any non-PK column used in `WHERE` or `ORDER BY` on a list endpoint.
- No soft-delete. Cascades are explicit in the schema.
- Don't expose Prisma errors to clients. Map `P2002 → CONFLICT`, `P2025 → NOT_FOUND`, else `INTERNAL`.

---

## 10. Security checklist (per PR)

- [ ] All new request bodies parsed with Zod.
- [ ] All new mutating endpoints call `requireSession()` (or a documented alternative guard) and check ownership.
- [ ] No **secret** read from `process.env` outside `lib/env.ts`. (`NEXT_PUBLIC_*` is exempt — the bundler requires a literal access.)
- [ ] No `dangerouslySetInnerHTML` introduced.
- [ ] Raw SQL only as a `$queryRaw` tagged template — never `$queryRawUnsafe` with interpolation.
- [ ] No new dependency without `pnpm audit` clean.
- [ ] Cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] Security headers untouched or improved (`next.config.ts`, `lib/csp.ts`).
- [ ] `AuditLog` written for any new sensitive action.
- [ ] Rate-limit applied to new auth or write endpoints (`lib/rate-limit.ts`).
- [ ] PII / secret keys never logged (verify the Pino redact list).
- [ ] CSP `connect-src` allows only the hosts you actually need.
- [ ] If touching contracts: WASM re-uploaded and hashes synced to the DB.

---

## 11. Performance

- Shape list queries with Prisma `select`/`include`; no implicit `SELECT *`.
- Page sizes default 20, max 100. List endpoints use cursor pagination.
- N+1 in an API route → `findMany({ include })`. In a Server Component → a single query.
- Live feed: Redis pub/sub, not Postgres `LISTEN/NOTIFY` (multi-instance friendly).
- Keep client bundles under ~250 KB gzipped per route. React Flow is heavy — lazy-load the canvas
  with `dynamic(() => import(...), { ssr: false })`.
- Use `next/image`, not a bare `<img>`.

---

## 12. Testing

**Unit (vitest)** — mandatory for `lib/flows/validate.ts`, `lib/flows/to-params.ts`,
`lib/flows/english.ts` (pure, high-leverage), `lib/stellar/deploy.ts` (mock the RPC client),
`lib/auth.ts` helpers, and every Zod schema (round-trip realistic _and_ adversarial inputs).

**Component (vitest `dom` project)** — `tests/unit/**/*.test.tsx`, rendered under jsdom with
`@testing-library/react` and `user-event`; query with `getByRole` and plain DOM (no jest-dom), and
scan with `axe-core` where accessibility is the claim. Test the extracted component, **never
`ConfigPanel`**: its `<style jsx>` needs Next's SWC styled-jsx transform, which vitest does not run.
Pure logic still belongs in a `*.utils.ts` tested in the `node` project. CI runs both projects via
`pnpm test:ci` and uploads the junit report as the `vitest-junit` artifact, with a job summary.

**E2E (Playwright)** — at least one happy path: log in as the seeded admin, build a splitter flow,
deploy with a mocked wallet signature, assert `CONFIRMED` plus a contract address, then fund and
assert the event feed animates the fan-out. Runs locally only; not wired into CI.

**Contracts** — each crate carries its own `#[test]` module using `soroban-sdk`'s test env; CI runs
`cargo test --workspace`.

---

## 13. Errors & logging

- Throw `AppError` from `lib/errors.ts`: `new AppError("VALIDATION", "human msg", { fields })`.
  Codes map to status in one place (`UNAUTHENTICATED` 401 … `INSUFFICIENT_FUNDS` 402, `INTERNAL` 500).
- Wrap every Route Handler body in `withErrorHandler(...)`. Don't hand-roll error shapes.
- Success responses use `{ data: T }` in most handlers; match the surrounding file.
- Never `console.log`; use `log.info({ ...ctx }, "message")` — `log` is the Pino root in `lib/log.ts`.
- Redact: `req.headers.cookie`, `req.headers.authorization`, `*.password`, `*.passwordHash`,
  `*.signedXdr`, `*.secretKey`, `*.AUTH_SECRET` (`REDACT_PATHS` in `lib/log.ts` is the list).

---

## 14. Env vars

- Access goes through `lib/env.ts`, which exposes `env()` — a **lazily parsed** Zod result — plus
  typed helpers (`stellarRpcUrl()`, `stellarWasmHash()`, `offRampTreasuryAddress()`, …). Prefer a
  helper over reaching into `env()` directly when one exists.
- Adding a var: define it in `lib/env.ts` with the right type and default policy, add it to
  `.env.example` under the right `# ---- section ----`, and set it in Railway before merging.
  `.env.example` is the only list — `README.md` points at it rather than restating it. A var read
  straight from `process.env` (a `NEXT_PUBLIC_*`, or a script-only one like `UPLOADER_SECRET`) still
  belongs in `.env.example`; that file documents what the app reads, not just what the schema
  validates.
- `NEXT_PUBLIC_*` is read directly from `process.env` at the point of use — the bundler needs a
  literal member access and cannot see through `env()`.

---

## 15. Frontend UX

- Forms show field-level errors from the server (`error.fields`) **and** the client (Zod resolver).
- Async actions show optimistic state, a toast on success, an inline error on failure.
- The builder canvas is keyboard accessible: arrows move the selected node, Delete removes it, Enter
  opens the config panel.
- Honour `prefers-reduced-motion: reduce` and disable edge animations.
- Contrast ≥ AA. The app is **dark-only** by design (`BRAND.md` §10) — don't add a light variant
  without updating `BRAND.md` first. Design tokens live in `app/globals.css` (`@theme`), not
  `tailwind.config.ts`.

---

## 16. Money / demo safety

- Every screen that submits a tx shows a network chip ("TESTNET" / "MAINNET") — see
  `data-testid="network-chip"` in `components/deploy/deploy-review.tsx`. Any new tx-submitting
  surface must carry one.
- For how the network is chosen and how to halt mainnet writes, see [§7.5](#75-networks).

---

## 17. Process

1. **If the change touches product behaviour or block semantics, read `SPEC.md` §3 first** and quote
   it in the PR description. `SPEC.md` covers intent, not implementation; many PRs have no relevant
   section, and that is expected rather than a gap to fill by adding one.
2. **Plan in three bullets**: what files change, what schema migrates, what tests are added.
3. **Make incorrect states unrepresentable.** Zod at every boundary, exhaustive `switch` with a
   `never` check.
4. **One concern per PR.** A schema change and a UI change are two PRs unless coupled.
5. **No `TODO:` without a tracking issue link.**
6. **Self-review with [§10](#10-security-checklist-per-pr)** before requesting human review.
7. Base branch is **`develop`**, not `main`.

---

## 18. Forbidden patterns

> If you write any of these, the diff will be rejected.

- ❌ Holding or transmitting a **user's** Stellar `secretKey` anywhere on the server.
- ❌ A **secret** read from `process.env` outside `lib/env.ts` (`NEXT_PUBLIC_*` exempt).
- ❌ `JSON.parse(request.body)` without a Zod schema.
- ❌ `eval`, `new Function`, `dangerouslySetInnerHTML`.
- ❌ `prisma.$queryRawUnsafe` with interpolated user input.
- ❌ Storing money as `number`.
- ❌ Logging cookies, tokens, or raw request bodies.
- ❌ `fetch(url)` to a user-supplied URL without an allowlist (SSRF).
- ❌ `// @ts-ignore` (use `// @ts-expect-error` with a reason).
- ❌ Committing `.env*` files other than `.env.example`.
- ❌ Editing the live DB instead of writing a migration.
- ❌ Adding a dep without justification + clean `pnpm audit`.

---

## 19. Known gaps — rules not enforced yet

These are real rules the project wants, currently unbacked by tooling. Don't assume CI catches them,
and don't cite them as already-true when reviewing.

| Rule                                                                 | Reality                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `any`; import ordering                                            | `eslint.config.mjs` doesn't extend `next/core-web-vitals` and explicitly disables `no-explicit-any` and `no-unused-vars`. No import-order plugin is installed. `pnpm lint` is close to a no-op; 12 `any` sites exist, none justified.                                                                           |
| Secrets only via `lib/env.ts`                                        | 32 `process.env` reads sit outside it, of which only 14 are `NEXT_PUBLIC_*` and 6 are `NODE_ENV`. `GROQ_API_KEY` (`lib/ai/groq.ts`) and `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (`lib/files/storage.ts`) are genuine violations; the rest is non-secret config that still bypasses the schema.                  |
| Re-parse signed XDR before submit ([§7.3](#73-submitting))           | Partial. `lib/stellar/signer.ts` re-parses every submitted envelope for source and hash; the deploy route asserts the signed hash matches the prepared one. Nothing compares operations, and `submit-trigger` / `submit-invoke` accept any envelope (`assertDepositEnvelope` is the pattern).                   |
| Branded Stellar types ([§6](#6-validation))                          | `lib/stellar/strkey.ts` has its first consumer, `lib/stellar/signer.ts`. Every other boundary still uses inline `StrKey` refinements.                                                                                                                                                                           |
| `safeRaw` tagged template                                            | Doesn't exist. Raw SQL is plain `$queryRaw` in `app/api/health` and `lib/admin-stats.ts`.                                                                                                                                                                                                                       |
| `app/` routes stay thin                                              | Several are not: `cron/auto-charge-payroll` (946 lines), `cron/process-offramp-jobs` (560), `deployments/[id]/submit` (594).                                                                                                                                                                                    |
| E2E in CI                                                            | No Playwright job exists in `.github/workflows/ci.yml`.                                                                                                                                                                                                                                                         |
| Mandatory unit tests ([§12](#12-testing))                            | `lib/flows/validate.ts`, `to-params.ts` and `english.ts` are covered. `lib/stellar/deploy.ts` and the `lib/auth.ts` helpers are not, and "every Zod schema" is not met. Decide in [#376](https://github.com/webnxt-2030/pinkraft/issues/376).                                                                   |
| `withErrorHandler` on every handler ([§13](#13-errors--logging))     | 9 of 95 routes skip it. Six are defensible (SSE `events`, `[...nextauth]`, binary `qr` / `files`, `health`, the `ingest` analytics proxy); `balances`, `poll-events` and `status` are unexplained and return a non-standard error shape. Tracked in [#376](https://github.com/webnxt-2030/pinkraft/issues/376). |
| Rate-limit on write endpoints ([§10](#10-security-checklist-per-pr)) | 31 mutating routes have none, including `deployments/[id]/submit`. Tracked in [#371](https://github.com/webnxt-2030/pinkraft/issues/371).                                                                                                                                                                       |
| Passkey add requires password re-auth ([§5](#5-authentication))      | Not implemented; session alone is enough. Tracked in [#375](https://github.com/webnxt-2030/pinkraft/issues/375).                                                                                                                                                                                                |

---

## 20. Known doc drift

Being worked through; don't trust these yet:

- `homepage/about.html` claims mainnet is "gated behind a per-user allowlist", and
  `homepage/terms.html` that it is "gated by an allowlist and an explicit confirmation". No allowlist exists —
  the claim stands and the control is being built to match it in
  [#377](https://github.com/webnxt-2030/pinkraft/issues/377), which also rewrites [§7.5](#75-networks).
- The generated changelog tables in `docs/instawards/changelog.md` and `week-2.md` stop at
  19 September, the extent of the public mirror, and omit the 20 September merges; the week-2 prose
  covers them. The rows are added the next time the mirror syncs; regenerate with
  `pnpm instawards:changelog --ref mirror/develop`, never from `origin/develop` (the SHAs differ).

---

## 21. Glossary

- **Soroban** — Stellar's smart contract platform.
- **SAC** — Stellar Asset Contract; the Soroban interface to a classic Stellar asset (e.g. USDC).
- **WASM hash** — content hash of an uploaded contract binary; many instances share one hash.
- **Footprint** — the read/write set declared in a Soroban tx.
- **SEP-7** — Stellar payment URI scheme (`web+stellar:pay?...`).
- **stroop** — 1e-7 XLM; the canonical integer unit for Stellar amounts.
- **Pipeline** — the set of contracts one flow deploys, wired by the factory in a single tx.

---

## 22. Knowledge graph (graphify)

`graphify-out/` holds a [graphify](https://github.com/Graphify-Labs/graphify) knowledge graph of the
repo: code via tree-sitter AST, plus text docs (`.md`, `.html`, `.yml`) via LLM extraction. PDFs,
images and evidence JSON are excluded (`.graphifyignore`). The graph is **gitignored and local to
each clone or worktree**, so it always describes the branch checked out there. Never commit it: a
multi-megabyte file every branch rewrites would conflict across parallel PRs.

Setup, once per machine: `uv tool install graphifyy && graphify install`. Per clone: build with
`/graphify .` in Claude Code, or copy `graphify-out/` from another clone (its extraction cache is
content-keyed and portable) and run `graphify update .`. The PreToolUse hooks that nudge toward the
graph live in `.claude/settings.json`, which is gitignored too — add them with
`graphify claude install`, then revert the section it appends to this file (§22 already covers it).

- For "where is X" / "what calls Y" / "how does A reach B", ask the graph before grepping:
  `graphify explain "withRelayerLock()"`, `graphify path "A" "B" --undirected`,
  `graphify query "<question>"`. `GRAPH_REPORT.md` is the overview; read it only for broad questions.
- `explain` and `path` are the precise tools. `query` is a keyword BFS and gets noisy on generic words.
- Grep is still right for exact strings, and the code is the authority — the graph can be stale.
- After changing code, run `graphify update .` before committing (AST only, seconds, no LLM).
  Pulls and branch switches refresh the code side on their own: `.husky/post-merge` and
  `.husky/post-checkout` run it in the background, and do nothing where graphify isn't installed.
- Docs are never refreshed automatically. After changing docs, or pulling changes to them, run
  `/graphify . --update` in Claude Code (re-extracts only the changed docs).
- If `graphify-out/` is missing, there is no graph here yet: grep as usual, and build or copy one
  when the task is large enough to benefit.

---

## Other agent configs

A Codex config (`~/.codex/config.toml`) and a Gemini CLI config (`~/.gemini/settings.json`) exist on
this machine. To bring over MCP servers, slash commands, subagents, skills, or instructions, reply
`/import` to scan and list what's importable, then `/import --yes=<digest>` with the digest from the
scan output. (If `/import` isn't available here, run `claude import` from a terminal.)
