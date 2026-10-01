# CLAUDE.md

Guidance for coding agents working in this repository.

> `SPEC.md` is the product spec — the authority on _what_ to build; this file is the authority on
> _how_. On a security question, the **stricter** rule wins. For the current shape of the code, read
> the code. When in doubt: stop and ask. Subdirectory guides load on demand: `tests/CLAUDE.md`,
> `components/builder/CLAUDE.md`.

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

| Task                                      | Command                                                        |
| ----------------------------------------- | -------------------------------------------------------------- |
| Typecheck                                 | `pnpm typecheck`                                               |
| Lint                                      | `pnpm lint` (close to a no-op — see [§19](#19-known-gaps))     |
| Format                                    | `pnpm format`                                                  |
| Unit tests                                | `pnpm test`                                                    |
| **One unit test file**                    | `pnpm test tests/unit/offramp/pdax.test.ts`                    |
| **One unit test by name**                 | `pnpm test -- -t "<test name substring>"`                      |
| Component tests only                      | `pnpm test --project dom`                                      |
| As CI runs it (junit to `reports/`)       | `pnpm test:ci`                                                 |
| Watch                                     | `pnpm test:watch`                                              |
| E2E (boots `pnpm dev` itself)             | `pnpm test:e2e` / `pnpm test:e2e tests/e2e/happy-path.spec.ts` |
| Screenshots (committed to `screenshots/`) | `pnpm screenshots` / `pnpm screenshots:mobile`                 |

Vitest runs a `node` project (`*.test.ts`) and a `dom` project (`*.test.tsx`, jsdom). **There is no
`@/lib/env` stub** — tests get the real schema, isolated by the per-file env scrub in
`tests/unit/setup.ts`; a test that mutates `process.env` cleans up after itself and calls
`vi.resetModules()` to clear `env()`'s memo. Details in `tests/CLAUDE.md`.

Contracts (Rust workspace, not built by the Node build):

```bash
pnpm contracts:deploy:testnet   # build → upload → deploy-factory → update-hashes
cd contracts && cargo test --workspace && cargo clippy --all-targets -- -D warnings
```

CI (`.github/workflows/ci.yml`): a **node** lane (`db:generate` → `db:migrate:deploy` → `typecheck`
→ `test:ci` → `db:seed` → `build` → `pnpm audit`) and a **rust** lane (`cargo fmt --check`,
`clippy -D warnings`, `cargo test --workspace`). Both must be green. **There is no E2E job.**

Stack and directory tree: [`README.md` → "Stack at a glance"](README.md#stack-at-a-glance) and
[→ "Project layout"](README.md#project-layout). This repo deliberately has **no** component
library, **no** client-state library, and **no** Server Actions — adding one is an architectural
change; raise it first. Before adding a dependency: justify it in the PR, keep `pnpm audit` clean,
and check the README's "things people expect to find and won't" list.

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

`pipelineSnapshot` (`nodeId → contractAddress → templateKind`) is the durable map. Anything that
talks to a deployed contract (event polling, balances, dev-mode mutation, relayer charges) resolves
through `lib/flows/pipeline-snapshot.ts`, **not** by re-deriving from the graph.
`lib/flows/english.ts` renders the graph as prose for the builder's preview pane.

### Deploys go through a factory, atomically

WASM is uploaded once per network; a `factory` contract deploys a whole pipeline in one
`deploy_pipeline` call, with child addresses pre-computed from deterministic salts (CAP-46) in
TypeScript and passed to neighbours as constructor args. The factory is **kind-agnostic**: adding a
node type means a new contract crate plus `to-params.ts`, `scval.ts`, the `TemplateKind` enum, and
`scripts/update-hashes.ts` — **not** the factory. See `docs/soroban-smart-contracts.md` §5.

### The one server-held key is the relayer (plus its derived channels)

`STELLAR_RELAYER_SECRET_KEY` is Paiflow's own key, used in `lib/stellar/relayer.ts` and
`lib/stellar/dev-mutate.ts` to sign `*_by_relayer` calls so scheduled charges and claims run without
the user signing each time. Contracts enforce dual auth (admin **or** relayer).

With `STELLAR_RELAYER_CHANNELS=N` (default `0`) the relayer also has N **channel accounts**, derived
deterministically from the relayer secret (`lib/stellar/relayer-channel-keys.ts`). No new key is
stored, but each is exactly as sensitive as the relayer secret — never log one. A channel is the
transaction **source and fee payer**; the relayer key signs only the Soroban auth entries. Rules in
[§7.6](#76-relayer-channels).

Submissions are serialized against `txBadSeq`: one lock per channel (`withRelayerChannel()`,
`lib/stellar/relayer-channels.ts`), or the single `withRelayerLock()` (`lib/stellar/client.ts`) with
channels off. **These locks are in-process only** — a second replica or a separate cron process can
still race them (#202).

### Config resolves env → DB; network is pinned per environment

`env()` is a **lazy function**, not an object: `import { env } from "@/lib/env"` then `env().FOO`.
`STELLAR_NETWORK` selects which `*_TESTNET` / `*_MAINNET` variables the `lib/env.ts` helpers return
— see [§7.5](#75-networks).

WASM hashes and the factory address resolve through `lib/stellar/config.ts`: the
`ContractTemplate` / `FactoryDeployment` **tables** first, env as fallback. `pnpm
contracts:update-hashes` copies `.env.local` values into those tables; an upload alone only reaches
your local app, never a deployed service. `update-hashes` has no `--network` flag — it reads
`STELLAR_NETWORK`, so it will happily sync testnet hashes after a mainnet upload. See
[`docs/mainnet-cutover.md`](docs/mainnet-cutover.md).

### Events: cron poll → Postgres → Redis → SSE

`/api/cron/poll-events` writes `ContractEvent` rows and publishes to Redis;
`/api/deployments/[id]/events` is the only SSE handler. The other `app/api/cron/*` routes drive
automation (charges, releases, finalization, off-ramp and streamer jobs). `poll-events` and the
relayer crons (`auto-charge-*`, `auto-release`) run under `withCronLease()` (`lib/cron/lease.ts`,
Redis `SET NX PX`; a held lease returns the normal zeroed shape with `leaseHeld: true`; unguarded
without Redis), take a bounded oldest-first batch, and stop at the time
budget in `lib/cron/config.ts`, reporting `truncated: true`.

Rows also arrive on demand: the `/api/v1` execute submit and `tx-status` ingest what they just sent,
the SSE handler and `GET /api/v1/deployments/:id/events` run `pollEventsFor()` (the latter bounded
and throttled per deployment, `lib/api/v1/events-freshness.ts`). Every writer moves `EventCursor`
through `advanceEventCursor()` (`lib/stellar/events.ts`), which only goes forward — **never upsert
the cursor directly**.

### Other subsystems

- **Fiat off-ramp** — `OffRampPayoutJob` state machine driven by `cron/process-offramp-jobs`
  against `lib/offramp/provider.ts`; mock by default, `OFFRAMP_PROVIDER=pdax` for real, with credentials stored in the DB via `/admin/offramp` (env is
  the fallback). See `docs/pdax-institution-api.md`.
- **Dev mode** — per-flow `devMode` swaps nodes for `_DEV` on-chain-mutable variants, filled after
  deploy via `/api/deployments/[id]/dev-*` (auth: `DevApiToken`). See
  `docs/design/2026-06-24-dev-mode-mutable-flows.md`.
- **Partner API** — `/api/v1`, machine callers with a `DeploymentApiToken` bound to one deployment
  ([§5](#5-authentication)). The older payroll and `dev-*` routes keep `requireDevAuth`.

### Sandbox sessions

With `SANDBOX_ENABLED=true` (testnet only — `env()` refuses it under mainnet), `POST
/api/auth/sandbox` mints a disposable `SANDBOX`-role user anyone can create. Its reach is the
**allowlist** in `lib/sandbox-paths.ts`, checked in `middleware.ts` ahead of `PUBLIC_PATHS`.
`SANDBOX_TEMPLATE_KINDS` (`lib/sandbox.ts`) is enforced against **every node** in
`/api/deployments/prepare`: a sandbox may only deploy pipelines the visitor's own wallet signs end
to end, never one the relayer later acts on. Nothing deletes sandbox users, so crons bound the work:
`cronPollableDeploymentWhere()` limits polling to `SANDBOX_POLL_WINDOW_MS`, and `cron/auto-release`
never loads a sandbox deployment.

---

## 3. Project conventions

### 3.1 Directory layout

- `app/` — routes. Delegate real work to `lib/`.
- `components/` — UI. **No DB access, ever** (no `@/lib/db`, no Prisma client). Server components
  receive data via props; client components `fetch` their own `/api/*` routes. Type-only imports
  from `lib/` and `@prisma/client` are fine.
- `lib/` — domain logic, pure where possible; side effects in `lib/db.ts`, `lib/redis.ts`,
  `lib/stellar/*`.
- `contracts/` — Rust workspace; never import from TS. `scripts/` — ops tooling, never imported at
  runtime.
- `homepage/` — static marketing site (own Railway service), plain HTML. `styles.css` is generated
  by `pnpm homepage:css`; don't hand-edit it.

### 3.2 Naming

- Files: **`kebab-case`** throughout (`.ts` and `.tsx`), whatever the export's casing.
- Components `PascalCase`; hooks `useCamelCase`; Zod schemas `XxxSchema` exporting both the schema
  and `z.infer<typeof XxxSchema>` as `Xxx`.
- One `route.ts` per endpoint, exporting `GET`, `POST`, …
- Server-only code starts with `import "server-only";`. `"use client"` only when needed.

### 3.3 TypeScript

- `tsconfig.json` is the source of truth for compiler flags (`strict`, `noUncheckedIndexedAccess`;
  `exactOptionalPropertyTypes` deliberately **off**).
- No `any` — use `unknown` + narrow; an escape hatch needs an `eslint-disable-next-line` with a
  reason (unenforced, [§19](#19-known-gaps)).
- Money: stroops are **`string`** in domain types, Zod schemas, and the DB (`amountStroops`, …).
  Convert to `bigint` for arithmetic and ScVal encoding, back to `string` at the boundary. **Never
  `number`** — a float loses precision at exactly the 7 decimals a stroop encodes.

### 3.4 Imports

Absolute via `@/*`. Order: node built-ins → external → `@/lib` → `@/components` → relative.

---

## 4. Next.js patterns

- Default to **Server Components**; `"use client"` for state, effects, browser APIs, or client-only
  libs (React Flow, wallet kit). Client components may `fetch` their own `/api/*` routes but never
  reach past the API into `lib/db` or a server-only module.
- **No Server Actions.** Every mutation is a Route Handler under `app/api/`, wrapped in
  `withErrorHandler`. The first `"use server"` is an architectural change — raise it first.
- Data: `import { db } from "@/lib/db"` (a `server-only` re-export of the singleton in
  `lib/prisma.ts`); don't add a second client. Use `db.$transaction` when write order matters. Never
  accept a `where` clause from user input.
- Caching: **none at the framework level** — no `revalidateTag`, no `cache:` option; keep it that
  way. Freshness after a mutation comes from re-rendering or the polling hooks in `lib/hooks/`. The
  one deliberate cache is `lib/contract-read-cache.ts`.
- SSE: a `ReadableStream` `Response` with `Content-Type: text/event-stream`, `Cache-Control:
no-cache, no-transform`, `Connection: keep-alive`, a 25s heartbeat, and an `AbortSignal` cleanup
  that unsubscribes Redis. Reference: `app/api/deployments/[id]/events/route.ts`.

---

## 5. Authentication

- `requireSession(opts?: { role?: Role })` (`lib/auth.ts`) at the top of every owner- or
  admin-scoped Route Handler; `getSessionUser()` is the nullable variant. Pages use
  `requirePageSession()`, which redirects an ended session to `GET /api/auth/stale-session`.
- Sessions are stateless JWTs. End one by incrementing `User.sessionVersion` in the same `update`
  as the change that warrants it (deactivate, password change/reset, role change, revoke-all) —
  never by deleting `Session` rows. `getSessionUser()` checks the row every request and returns the
  row's role, not the token's.
- Passwords: argon2id, never logged. Login success: rotate session ID, set `lastLoginAt`, write
  `AuditLog{ action: "USER_LOGIN" }`. 5 failures: `lockedUntil = now + 15min`, generic error.
- `Role.SANDBOX` is a disposable user anyone can mint, and `requireSession()` accepts it. Only
  `lib/sandbox-paths.ts` keeps it out of a route — add routes there deliberately, and never add a
  relayer-signed template kind to `SANDBOX_TEMPLATE_KINDS`.
- `/api/cron/*` uses `requireCronSecret(req)` (the `x-cron-secret` header), never
  `requireSession()`. It fails **closed** in production when `CRON_SECRET` is unset or under 32
  chars — these routes are public in `middleware.ts` and several sign with the relayer key. Off
  production an unset secret leaves them open, which local dev relies on.
- Compare a presented secret with `timingSafeEqualString()` (`lib/auth/timing-safe.ts`), never
  `===`, and don't hand-roll another.
- `/api/v1/deployments/:id/*` handlers are `v1Route({ rateLimit }, fn)` (`lib/api/v1/handler.ts`):
  error handling, UUID check, `Bearer pfk_…` token auth with one generic `UNAUTHENTICATED`, and a
  per-token rate limit. `/api/v1` is in `PUBLIC_PATHS`, so the wrapper is the only guard. Tokens are
  hashed with `hashApiToken()` (`lib/auth/api-token.ts`).
- Passkey registration needs only a live session, no password re-check ([§19](#19-known-gaps)).

---

## 6. Validation

- One Zod schema per request body, in `lib/<feature>/schema.ts`, reused by the client
  (`react-hook-form` resolver) and the server.
- Parse, don't validate: `MySchema.parse(await req.json())`; `withErrorHandler` maps `ZodError →
422 { error: { code: "VALIDATION", fields } }`.
- Stellar addresses: `StrKey.isValidEd25519PublicKey` / `StrKey.isValidContract` via inline Zod
  `.refine(...)`. The branded types in `lib/stellar/strkey.ts` are only partly adopted.
- Flow validation (`lib/flows/validate.ts`: DAG, one trigger root, splitter bps summing to 10_000,
  pending addresses) runs in `/api/flows/:id/validate` **and** again in `/api/deployments/prepare`.

---

## 7. Stellar / Soroban

### 7.1 Clients

- `sorobanRpc()` and `horizon()` (`lib/stellar/client.ts`) are lazy memoized **functions**; their
  URLs reject plaintext HTTP.
- All RPC calls live in `lib/stellar/*`. No component imports `@stellar/stellar-sdk` directly.

### 7.2 Building transactions

- Always `simulateTransaction` before returning XDR; use `rpc.assembleTransaction(tx, sim).build()`.
- Explicit fees and `setTimeout(180)`, never `TimeoutInfinite`.
- The user's account is `source` for user-initiated deploys.

### 7.3 Submitting

- `sendTransaction` → poll `getTransaction` until `SUCCESS|FAILED`, max 30s. On `SUCCESS`, persist
  the contract addresses from the result meta as `pipelineSnapshot`.
- Idempotent on the tx hash recomputed from the signed XDR.
- **Intended, only partly implemented:** re-parse the signed XDR and assert its operations match
  what we built ([§19](#19-known-gaps)).

### 7.4 Reading events

- Decoding is hand-rolled in `lib/stellar/events.ts` — don't trust topic order.
  (`ContractTemplate.abiJson` is stored but never read.)
- Idempotency is the `ContractEvent.eventId` unique constraint, **not** `(txHash, kind)`.

### 7.5 Networks

**Canonical statement of the network model. Don't restate it elsewhere — link here.**

- Never read the network passphrase from the wallet's runtime config; the server is the source of
  truth.
- The network is pinned per environment via `STELLAR_NETWORK` (local/staging = `testnet`,
  production = `mainnet`). There is **no** per-deploy picker, **no** `ENABLE_MAINNET` flag, and
  **no** `MAINNET_ALLOWLIST`. _Who can deploy_ is the auth system's job; _which network_ is the
  environment's.
- Mainnet writes happen only because the production Railway service has `STELLAR_NETWORK=mainnet`.
  No in-app override, no per-user allowlist, no confirmation. **The kill switch is scaling the prod
  service to zero.**
- Runbook: [`docs/mainnet-cutover.md`](docs/mainnet-cutover.md).

### 7.6 Relayer channels

Stellar applies one transaction per source account per ledger, so a relayer that is its own source
manages only a few a minute. Channels lift that: N sources, one lock each.

- Wrap every relayer-signed Soroban call in `withRelayerChannel(async (channel) => …)` and build it
  with `buildRelayerTx({ channel, operation, onSimulationError })`. Never sign a relayer transaction
  by hand with `Keypair.fromSecret(relayerSecret)`. `buildRelayerTx` simulates to find every address
  that must authorize, signs the relayer's entries, keeps caller-supplied entries for other addresses,
  re-simulates so footprint and fee cover the signatures, then has the channel sign the envelope.
- **A source-account credential authorizes the source, which on a channel is not the relayer.** Any
  new call whose contract does `relayer.require_auth()` must go through `buildRelayerTx`; never
  reuse a simulation taken with the relayer as source.
- Keep load-account → sign → send (→ finality) inside the callback. A caller that returns before
  finality calls `channel.trackPending(hash)` so the next holder waits for it.
- `depositNativeToProvider` and `refundFromTreasury` stay on the relayer-source lane
  (`withRelayerLock()`), which is also the fallback when no channel is funded.
- Unfunded channels are skipped and retried after a minute; fund them with `pnpm relayer:channels`.
  `/api/health` reports `relayerChannels: "funded/configured"`. Roll back with
  `STELLAR_RELAYER_CHANNELS=0`.

---

## 8. Smart contract templates (Rust)

- Treat any change as a **breaking ABI change** unless proven otherwise; re-upload WASM and re-run
  `pnpm contracts:update-hashes` for every network.
- `i128` and checked math. `unwrap()` only on values the contract itself produced.
- Every state-mutating call does `require_auth()` on the authorizing address.
- `[profile.release]` is declared once on the workspace — not per crate.
- Pipeline and "how to add a contract": `docs/soroban-smart-contracts.md` §4.2–4.3 and §5.

---

## 9. Database (Prisma)

- Migrations are mandatory (`pnpm db:migrate` dev, `prisma migrate deploy` CI/prod). Never edit a
  merged migration.
- `@@index` any non-PK column used in `WHERE` / `ORDER BY` on a list endpoint.
- No soft-delete; cascades are explicit in the schema.
- Never expose Prisma errors: `P2002 → CONFLICT`, `P2025 → NOT_FOUND`, else `INTERNAL`.

---

## 10. Security checklist (per PR)

Everything in [§18](#18-forbidden-patterns), plus:

- [ ] New request bodies parsed with Zod.
- [ ] New mutating endpoints call `requireSession()` (or a documented alternative guard) and check
      ownership.
- [ ] Cookies: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`.
- [ ] Security headers (`next.config.ts`, `lib/csp.ts`) untouched or improved; CSP `connect-src`
      lists only hosts you need.
- [ ] `AuditLog` written for any new sensitive action.
- [ ] Rate limit (`lib/rate-limit.ts`) on new auth or write endpoints.
- [ ] Nothing sensitive logged — check `REDACT_PATHS` in `lib/log.ts`.
- [ ] Contracts touched: WASM re-uploaded and hashes synced to the DB.

---

## 11. Performance

- List queries use Prisma `select`/`include` and cursor pagination; page size default 20, max 100.
- Avoid N+1: `findMany({ include })` in routes, a single query in Server Components.
- Live feed is Redis pub/sub, not Postgres `LISTEN/NOTIFY`.
- Keep route bundles under ~250 KB gzipped; lazy-load the React Flow canvas with
  `dynamic(() => import(...), { ssr: false })`.

---

## 12. Testing

Unit tests are **mandatory** for `lib/flows/validate.ts`, `to-params.ts`, `english.ts`,
`lib/stellar/deploy.ts` (mock the RPC client), `lib/auth.ts` helpers, and every Zod schema
(realistic _and_ adversarial inputs). Component tests go in the `dom` project; E2E runs locally
only. Conventions and env isolation: `tests/CLAUDE.md`.

---

## 13. Errors & logging

- Throw `AppError` (`lib/errors.ts`): `new AppError("VALIDATION", "msg", { fields })`; codes map to
  HTTP status in one place.
- Wrap every Route Handler in `withErrorHandler(...)`. Success is `{ data: T }` in most handlers —
  match the surrounding file.
- Never `console.log`; use `log` (Pino, `lib/log.ts`): `log.info({ ...ctx }, "message")`.

---

## 14. Env vars

- Go through `lib/env.ts`: `env()` or, preferably, a typed helper (`stellarRpcUrl()`, …).
- Adding a var: define it in `lib/env.ts`, add it to `.env.example` under the right `# ----
section ----`, and set it in Railway before merging. `.env.example` documents everything the app
  reads, including `NEXT_PUBLIC_*` and script-only vars.
- `NEXT_PUBLIC_*` is read from `process.env` at the point of use — the bundler needs the literal
  access.

---

## 15. Frontend UX

- Forms show field errors from the server (`error.fields`) **and** the client (Zod resolver).
- Async actions: optimistic state, a toast on success, an inline error on failure.
- Honour `prefers-reduced-motion: reduce` (disable edge animations). Contrast ≥ AA.
- **Dark-only** by design (`BRAND.md` §10) — no light variant without updating `BRAND.md` first.
  Design tokens live in `app/globals.css` (`@theme`), not `tailwind.config.ts`.
- The builder canvas is fully keyboard accessible with a mobile layout below 768px — details in
  `components/builder/CLAUDE.md`.

---

## 16. Money / demo safety

Every tx-submitting screen shows a network chip ("TESTNET" / "MAINNET"; `data-testid="network-chip"`
in `components/deploy/deploy-review.tsx`). Any new one must carry it.

---

## 17. Process

1. If the change touches product behaviour or block semantics, read `SPEC.md` §3 first and quote it
   in the PR. Many PRs have no relevant section; that's expected.
2. Plan in three bullets: files changed, schema migrated, tests added.
3. Make incorrect states unrepresentable: Zod at every boundary, exhaustive `switch` with `never`.
4. One concern per PR.
5. No `TODO:` without a tracking issue link.
6. Self-review with [§10](#10-security-checklist-per-pr).
7. Base branch is **`develop`**, not `main`.

---

## 18. Forbidden patterns

> If you write any of these, the diff will be rejected.

- ❌ Holding or transmitting a **user's** Stellar `secretKey` anywhere on the server.
- ❌ A **secret** read from `process.env` outside `lib/env.ts` (`NEXT_PUBLIC_*` exempt).
- ❌ `JSON.parse(request.body)` without a Zod schema.
- ❌ `eval`, `new Function`, `dangerouslySetInnerHTML`.
- ❌ `$queryRawUnsafe` with interpolated input — raw SQL only as a `$queryRaw` tagged template.
- ❌ Storing money as `number`.
- ❌ Logging cookies, tokens, passwords, secret keys, signed XDR, or raw request bodies.
- ❌ `fetch(url)` to a user-supplied URL without an allowlist (SSRF).
- ❌ `// @ts-ignore` (use `// @ts-expect-error` with a reason).
- ❌ Committing `.env*` files other than `.env.example`.
- ❌ Editing the live DB instead of writing a migration.
- ❌ Adding a dependency without justification and a clean `pnpm audit`.

---

## 19. Known gaps

Several rules above are **not enforced by tooling**: `pnpm lint` doesn't ban `any` or check import
order, secrets are still read outside `lib/env.ts` in places, a few routes skip
`withErrorHandler`, most `GET` routes have no rate limit, signed XDR operations aren't compared,
passkey add needs no re-auth, and there is no E2E in CI. Don't assume CI catches these or cite them as true in review.
The full table, with file names and tracking issues, plus known doc drift:
[`docs/known-gaps.md`](docs/known-gaps.md).

**Pipeline** (used throughout): the set of contracts one flow deploys, wired by the factory in a
single transaction.
