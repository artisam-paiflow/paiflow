# Pink Raft

> **Zaps for money.** A visual builder where you connect triggers (_"when this happens"_) to actions (_"pay this"_) and deploy a live Soroban contract on Stellar in under a minute.

Drag `On Receive USDC` → `Split 60/30/10` onto a canvas, hit **Deploy**, get a QR code. Anyone who scans it sends funds straight to a pre-audited smart contract that fans out the money automatically.

|             |                                                                                   |
| ----------- | --------------------------------------------------------------------------------- |
| **Status**  | v0.2 — visual builder, live deployments, raft-log voice input, live event polling |
| **License** | MIT                                                                               |

---

## Stack

| Layer         | Tech                                                                          |
| ------------- | ----------------------------------------------------------------------------- |
| Runtime       | Node.js 22 LTS, pnpm 10                                                       |
| Framework     | Next.js 15 (App Router, RSC, Server Actions), React 19                        |
| UI            | Tailwind 4, shadcn/ui, lucide-react, framer-motion, @xyflow/react             |
| State         | zustand (canvas), TanStack Query (server), react-hook-form + zod (forms)      |
| Auth          | Auth.js v5 (`next-auth`) with Prisma adapter; WebAuthn via `@simplewebauthn`  |
| DB            | PostgreSQL 16 + Prisma 6                                                      |
| Cache / queue | Redis 7 (`ioredis`)                                                           |
| Storage       | MinIO (dev) / Railway Volume (prod)                                           |
| Email         | Resend (transactional — password reset, notifications)                        |
| AI            | Groq — Whisper (STT, raft-log voice input) + Llama (text)                     |
| Blockchain    | Stellar / Soroban — `@stellar/stellar-sdk`, `@creit.tech/stellar-wallets-kit` |
| Contracts     | Rust 1.88, `soroban-sdk` 22, `wasm32v1-none`                                  |
| Observability | Sentry, pino                                                                  |

---

## Quick start

### Prerequisites

- Node `22.11.x` (capped at `<23` — see `engines` in `package.json`)
- pnpm `10.4.1` — `corepack enable && corepack prepare pnpm@10.4.1 --activate`
- Docker (for Postgres / Redis / MinIO)
- _(Optional)_ A [Resend](https://resend.com) account for outbound transactional email (password reset). When unset, emails are logged to the dev console.
- _(Optional)_ A [Groq](https://groq.com) API key for raft-log voice input + AI features. When unset, those features degrade gracefully.
- _(Optional, for contract work)_ Rust `1.88.0` with the `wasm32v1-none` target:
  ```bash
  rustup install 1.88.0
  rustup component add rustfmt clippy --toolchain 1.88.0
  rustup target add wasm32v1-none --toolchain 1.88.0
  ```

### First-time setup

```bash
# 1. Install deps
pnpm install

# 2. Configure environment
cp .env.example .env
# Required values to generate / set:
#   AUTH_SECRET=$(openssl rand -base64 48)
#   ADMIN_SEED_PASSWORD=<≥12 chars>
#   CRON_SECRET=$(openssl rand -hex 32)

# 3. Start backing services
pnpm docker:up               # Postgres + Redis + MinIO
# or:  docker compose --profile core up -d   # Postgres + Redis only

# 4. Run migrations and seed the admin user
pnpm db:migrate
pnpm db:seed

# 5. Boot the app
pnpm dev                     # http://localhost:3000
```

Log in with `admin` / your `ADMIN_SEED_PASSWORD`. In local dev without a `RESEND_API_KEY`, outbound emails (e.g. password reset) are logged to the server console instead of delivered.

### Local services map

| Service  | Port(s)     | Notes                                                |
| -------- | ----------- | ---------------------------------------------------- |
| Next.js  | 3000        | `pnpm dev`                                           |
| Postgres | 5432        | `pinkraft / pinkraft / pinkraft`                     |
| Redis    | 6379        | —                                                    |
| MinIO    | 9000 / 9001 | console at `:9001`, `pinkraft / pinkraft-dev-secret` |

> **Email** (Resend) and **AI** (Groq) are cloud services, not local containers — set their API keys to enable, leave them unset to degrade to dev-console logs / disabled features.

---

## Scripts

### App

| Script           | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Next.js dev server with HMR                  |
| `pnpm build`     | `prisma generate && next build`              |
| `pnpm start`     | `prisma migrate deploy && next start` (prod) |
| `pnpm typecheck` | `tsc --noEmit`                               |
| `pnpm lint`      | `next lint`                                  |
| `pnpm format`    | Prettier across the repo                     |

### Tests

| Script                    | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `pnpm test`               | Vitest unit suite (one-shot)                     |
| `pnpm test:watch`         | Vitest in watch mode                             |
| `pnpm test:e2e`           | Playwright end-to-end                            |
| `pnpm screenshots`        | Regenerate desktop screenshots in `screenshots/` |
| `pnpm screenshots:mobile` | Regenerate mobile screenshots                    |

### Database

| Script                   | Purpose                              |
| ------------------------ | ------------------------------------ |
| `pnpm db:generate`       | Regenerate Prisma Client             |
| `pnpm db:migrate`        | Create + apply a new migration (dev) |
| `pnpm db:migrate:deploy` | Apply pending migrations (CI / prod) |
| `pnpm db:seed`           | Run `prisma/seed.ts`                 |
| `pnpm db:studio`         | Open Prisma Studio                   |

### Contracts (Soroban)

| Script                  | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `pnpm contracts:build`  | `cargo build --release --target wasm32v1-none`      |
| `pnpm contracts:upload` | Upload WASM to testnet, write hashes back to `.env` |

Or directly:

```bash
cd contracts
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

### Docker

| Script             | Purpose                               |
| ------------------ | ------------------------------------- |
| `pnpm docker:up`   | Start all services (`--profile full`) |
| `pnpm docker:down` | Stop services **and wipe volumes**    |

---

## Features

- **Visual flow builder** — drag triggers + actions onto a canvas (`@xyflow/react`), wire them up, validate, deploy.
- **Soroban deployments** — non-custodial: the backend prepares XDR, the user's wallet signs. Three contract types: `splitter`, `streamer`, `conditional`.
- **QR + public trigger** — every deployment gets a shareable QR / link that opens a pre-filled trigger page; rate-limited public endpoints with audit logging.
- **Live event polling** — two-phase poller seeded from the deployment tx ledger writes `ContractEvent` rows so the UI shows real on-chain activity.
- **Raft-log voice input** — floating mic captures voice, Groq Whisper transcribes live, the result flows into AI-assisted authoring of flows.
- **Auth** — username + password (argon2), optional WebAuthn second factor, password reset via Resend, HIBP-pwned-password check (opt-in).
- **Admin** — user management, audit log, seeded admin on first boot.

---

## Project layout

```
app/             Next.js App Router (routes, layouts, Server Actions)
  api/             Route handlers (trigger, cron, auth, transcribe, …)
  flows/           Visual builder canvas
  deployments/     Deployment list + detail (with live event feed)
  trigger/         Public trigger page (QR target)
  admin/           Admin console
components/      Shared React components (shadcn/ui lives here)
lib/             Server + shared utilities (auth, db, stellar, validation, …)
prisma/          schema.prisma, migrations, seed.ts
contracts/       Soroban smart contracts (Rust workspace)
  splitter/         60/30/10-style payment splitter
  streamer/         time-based linear vesting / streaming
  conditional/      release-on-condition escrow
scripts/         Operational scripts (e.g. upload-wasm.ts)
tests/
  unit/             Vitest specs
  e2e/              Playwright specs
screenshots/     Generated UI screenshots (committed)
```

---

## Branching & CI

| Branch                  | Role                                       |
| ----------------------- | ------------------------------------------ |
| `main`                  | Production-ready; protected. PRs go here.  |
| `staging`               | Pre-prod deploy target.                    |
| `develop`               | Integration branch for in-flight features. |
| `claude/*`, `feat/*`, … | Short-lived feature branches.              |

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every PR:

- **node** lane — `pnpm install --frozen-lockfile`, `db:generate`, `typecheck`, `test`, `db:migrate:deploy`, `db:seed`, `build`, `pnpm audit`
- **rust** lane — `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`

Both lanes must be green before merge.

---

## Environment variables

`.env.example` is the source of truth — copy it and fill the marked secrets. The shape:

- **App** — `NEXT_PUBLIC_APP_URL`, `LOG_LEVEL`
- **Auth** — `AUTH_SECRET`, `AUTH_URL`, `AUTH_RP_ID`, `AUTH_RP_NAME`, `ALLOW_PUBLIC_REGISTRATION`, `ADMIN_SEED_USERNAME`, `ADMIN_SEED_PASSWORD`
- **Database** — `DATABASE_URL`
- **Redis** — `REDIS_URL`
- **File storage** — `FILE_STORAGE_DRIVER`, `FILE_STORAGE_PATH`, `MINIO_*`
- **Stellar** — `STELLAR_NETWORK` (pinned per environment), `STELLAR_*_TESTNET`, `STELLAR_*_MAINNET`, `STELLAR_FRIENDBOT_URL` (testnet only), `STELLAR_WASM_HASH_*_TESTNET`, `STELLAR_WASM_HASH_*_MAINNET`
- **Cron** — `CRON_SECRET`
- **AI / STT** — `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_STT_MODEL_PRIMARY`, `GROQ_STT_MODEL_FALLBACK`
- **Email** — `RESEND_API_KEY`, `EMAIL_FROM`
- **Optional** — `SENTRY_DSN`, `HIBP_CHECK_ENABLED`

> **Never** put a Stellar secret key in `.env`. Pink Raft is non-custodial — the backend builds and submits transactions, but only the user's wallet signs them.

---

## Deployment

Configured for **Railway** (`railway.toml`, `nixpacks.toml`):

- `pnpm build` produces the standalone Next.js bundle.
- `pnpm start` runs `prisma migrate deploy` before booting `next start`.
- File storage swaps from MinIO to a Railway Volume via `FILE_STORAGE_DRIVER`.
