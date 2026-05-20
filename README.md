# Pink Raft

> **Zaps for money.** A visual builder where you connect triggers (_"when this happens"_) to actions (_"pay this"_) and deploy a live Soroban contract on Stellar in under a minute.

Drag `On Receive USDC` → `Split 60/30/10` onto a canvas, hit **Deploy**, get a QR code. Anyone who scans it sends funds straight to a pre-audited smart contract that fans out the money automatically.

|                 |                                                                   |
| --------------- | ----------------------------------------------------------------- |
| **Spec**        | [`SPEC.md`](./SPEC.md) — product + architecture (1k lines)        |
| **Agent guide** | [`AGENT.md`](./AGENT.md) — how this codebase is meant to be built |
| **Status**      | v0.2 — foundation + audit fixes landed, see PR #1                 |
| **License**     | MIT                                                               |

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

> **Email** is a cloud service (Resend), not a local container — set `RESEND_API_KEY` to deliver, leave it unset to log to the dev console.

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

## Project layout

```
app/             Next.js App Router (routes, layouts, Server Actions)
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
- **File storage** — `FILE_STORAGE_DRIVER`, `MINIO_*`
- **Stellar** — `STELLAR_NETWORK`, `STELLAR_*_TESTNET`, `STELLAR_FRIENDBOT_URL`, `ENABLE_MAINNET`, `STELLAR_WASM_HASH_*`
- **Cron** — `CRON_SECRET`
- **Optional** — `SENTRY_DSN`, `HIBP_CHECK_ENABLED`

> **Never** put a Stellar secret key in `.env`. Pink Raft is non-custodial — the backend builds and submits transactions, but only the user's wallet signs them. See `AGENT.md` §0.

---

## Deployment

Configured for **Railway** (`railway.toml`, `nixpacks.toml`):

- `pnpm build` produces the standalone Next.js bundle.
- `pnpm start` runs `prisma migrate deploy` before booting `next start`.
- File storage swaps from MinIO to a Railway Volume via `FILE_STORAGE_DRIVER`.

For full details see `SPEC.md` §15.

---

## Contributing

1. Read `AGENT.md` first — it's short and load-bearing.
2. Branch from `develop` for features, `main` for hot-fixes.
3. Keep PRs scoped; CI must be green; types and tests are not optional.
4. Conventional-ish commits (`ci:`, `contracts:`, `feat:`, `fix:` …).
