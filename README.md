# Pink Raft

> **Zaps for money.** A visual builder where you connect triggers (_"when this happens"_) to actions (_"pay this"_) and deploy a live Soroban contract on Stellar in under a minute.

Drag `On Receive USDC` → `Split 60/30/10` onto a canvas, hit **Deploy**, get a QR code. Anyone who scans it sends funds straight to a pre-audited smart contract that fans out the money automatically.

|             |                                                                                   |
| ----------- | --------------------------------------------------------------------------------- |
| **Status**  | v0.2 — visual builder, live deployments, raft-log voice input, live event polling |
| **License** | MIT                                                                               |

---

## 🧩 Problem

Every fintech, MSME, and SMB that wants **programmable payments** today has two options:

1. Hire a Rust developer who knows Soroban (rare, expensive, slow), or
2. Pick from off-the-shelf SaaS that locks them into someone else's rails and fees.

There's no middle layer — no Stripe Connect, no Zapier-for-money — that lets a non-technical operator wire up `"when this happens, send that"` and deploy it as their own on-chain contract. The result: programmable payouts stay out of reach of the people who actually need them (creators splitting revenue with collaborators, OFWs sending periodic remittances, MSMEs paying contractor pools, household budgets fanning income across accounts).

## 🌟 Vision

Make programmable payments a **drag-and-drop primitive**, the way Zapier made cross-SaaS automation a drag-and-drop primitive a decade ago. Anyone who can sketch a flow on a whiteboard should be able to ship the same flow as a non-custodial Soroban contract — owning their keys, their funds, and their logic — in under 90 seconds, on a phone, without ever touching Rust or XDR.

Long-term, Pink Raft is the canonical "no-code Stellar surface": the layer between the chain's primitives (atomic transfers, Soroban host functions, SEP-7 deep links) and the operators who want to compose them into real-world money flows.

## 🎯 Purpose

Built for the **Stellar Hackathon 2026**.

We picked this problem because the Stellar Soroban toolchain is genuinely excellent for backend developers and genuinely opaque to everyone else. Three pre-audited templates (splitter, streamer, conditional) cover the long tail of real-world payment workflows — most "programmable payment" use cases reduce to one of those three. By shipping them as visual blocks instead of as Rust libraries, we put the chain's full power in the hands of the operators who have the use case but not the engineering team.

The mission: **make Stellar the easiest chain on which to ship a payment flow**, full stop, without changing what makes Stellar good (fast, cheap, atomic, non-custodial).

## 👥 Target Users

- **Fintech product managers / founders** — need programmable payouts (revenue splits, partner programs, escrow), don't have a Rust team, won't accept being locked into a closed SaaS.
- **MSME / SMB operators** — running creator collabs, freelancer pools, supplier-payment fan-outs. Want self-custody and audit-grade transparency without learning a new SDK.
- **OFWs and remittance senders** — periodic family payouts, automatic budget splits (rent + savings + spending) once funds land on-chain.
- **Non-technical operators on a phone** — the hero demo is "presenter drags 3 blocks on a phone, hits Deploy, audience scans QR, money moves in 5 seconds." If a flow can't ship from a phone, we haven't solved the problem.

## ✨ Features

- **Visual flow builder** — drag triggers (`On Receive`, `On Schedule`) and actions (`Pay`, `Split`) onto a `@xyflow/react` canvas, wire them up, validate, deploy.
- **Three Soroban templates** —
  - **Splitter** — 60/30/10-style fan-out across N recipients (BPS-weighted).
  - **Streamer** — time-based linear vesting / streaming payouts.
  - **Conditional** — release-on-condition escrow (time, amount, oracle).
- **Non-custodial deploy** — the backend prepares simulated XDR; the user's wallet (Freighter / xBull / Albedo / Hana / LOBSTR via `@creit.tech/stellar-wallets-kit`) signs. Private keys never touch the server.
- **QR-triggered execution** — every deployment renders a public QR / dApp URL. Anyone with a wallet can scan it, sign, and fire `distribute()` — useful for audience-funded demos, public crowdpay flows, and self-fund-back tests. Rate-limited + audit-logged on the public endpoints.
- **Live event feed** — two-phase poller seeded from the deployment transaction's ledger writes `ContractEvent` rows in real time; the deployment page animates payouts as they finalize on-chain.
- **Raft Log AI assistant** — voice-to-text via Groq Whisper (large-v3 with fallback to large-v3-turbo) + Llama text edits. Talk to the builder in plain English ("change Alice to 55%"); the AI emits a JSON patch the validator can apply.
- **Auth + reset** — argon2 password hashing, optional WebAuthn second factor, password reset via Resend with SHA-256-hashed tokens and session wipe on consume.
- **Admin console** — user management, audit log, seeded admin on first boot, rate-limited public endpoints, HIBP-pwned-password check (opt-in).
- **stellar.expert deep links** — every contract address in the UI links to the correct (`testnet` ↔ `public`) explorer.

## 🛠️ Tech Stack

- **Frontend** — Next.js 15 (App Router, React 19 RSC, Server Actions), Tailwind 4, shadcn/ui, `@xyflow/react`, framer-motion, zustand, TanStack Query, react-hook-form + zod
- **Backend** — Next.js Route Handlers, PostgreSQL 16 + Prisma 6, Redis 7 (`ioredis`) for rate-limits + event stream, Auth.js v5 (`next-auth`) + Prisma adapter, argon2, `@simplewebauthn`
- **Blockchain** — Stellar / Soroban via `@stellar/stellar-sdk` (Horizon + Soroban RPC), `@creit.tech/stellar-wallets-kit` (Freighter / xBull / Albedo / Hana / LOBSTR), SEP-7 deep links
- **Smart contracts** — Rust `1.88`, `soroban-sdk` 22, `wasm32v1-none` target. Workspace contains splitter / streamer / conditional crates with full unit-test coverage
- **AI** — Groq (Whisper STT + Llama text), with a pluggable OpenAI-compatible fallback via `AI_API_KEY` / `AI_BASE_URL`
- **Email** — Resend (transactional — password reset, notifications)
- **File storage** — MinIO (dev) / Railway Volume (prod) — pluggable via `FILE_STORAGE_DRIVER`
- **Observability** — pino structured logs, Sentry (opt-in via `SENTRY_DSN`)
- **Infrastructure** — Railway (`railway.toml`, `nixpacks.toml`), Docker Compose for local Postgres + Redis + MinIO
- **CI / tooling** — GitHub Actions (node + rust lanes), Vitest unit tests, Playwright e2e, ESLint, Prettier, husky + lint-staged

## 🚀 How to Run Locally

```bash
# 1. Clone
git clone https://github.com/webnxt-2030/pinkraft.git
cd pinkraft

# 2. Install deps (requires Node 22.11.x and pnpm 10.4.1)
corepack enable && corepack prepare pnpm@10.4.1 --activate
pnpm install

# 3. Configure environment
cp .env.example .env
# Set the required values:
#   AUTH_SECRET=$(openssl rand -base64 48)
#   ADMIN_SEED_PASSWORD=<≥12 chars>
#   CRON_SECRET=$(openssl rand -hex 32)
# Optional (degrade gracefully if unset):
#   RESEND_API_KEY=<from resend.com>  — outbound email
#   GROQ_API_KEY=<from groq.com>      — voice + AI features

# 4. Start backing services (Postgres + Redis + MinIO)
pnpm docker:up

# 5. Migrate + seed
pnpm db:migrate
pnpm db:seed

# 6. Boot the app
pnpm dev
# → http://localhost:3000
```

Log in with `admin` / your `ADMIN_SEED_PASSWORD`. Without `RESEND_API_KEY`, password-reset emails are logged to the dev console instead of delivered. Without `GROQ_API_KEY`, the Raft Log voice + AI features show a graceful disabled state.

> **Full developer reference** (scripts, env vars, branching, CI) lives further down in this README under [Developer reference](#developer-reference).

## 🌐 Deployment

Pink Raft is **non-custodial** — the backend prepares XDR, but only the user's wallet signs. The Stellar network is pinned at the environment level via `STELLAR_NETWORK` (staging = `testnet`, production = `mainnet`); there is no per-deploy network picker. Operator runbook for the cutover: [`docs/mainnet-cutover.md`](./docs/mainnet-cutover.md).

### Testnet

Deployed via Railway from `staging` (auto-deploy on merge into `staging`).

- **App URL**: https://pinkraft.up.railway.app/
- **📸 Stellar Expert (testnet)**:
<img width="1251" height="891" alt="image" src="https://github.com/user-attachments/assets/e93400b1-82d5-45ec-b3ea-1af2bdb2b68e" />


### Mainnet

Cutover gated by `docs/mainnet-cutover.md`. WASM hashes uploaded via `pnpm contracts:upload --network=mainnet`.

- **App URL**: https://pinkraft.xyz/
- **📸 Stellar Expert (mainnet)**:
<img width="1259" height="887" alt="image" src="https://github.com/user-attachments/assets/be166d1c-93eb-4cef-b6f7-a8d75e15241c" />


## 🎥 Demo

- 🔗 **Live App**: https://pinkraft.xyz/
- 🎬 **Demo Video**: https://www.youtube.com/watch?v=VkOgegleb9A
[![Pink Raft Demo Video](https://img.youtube.com/vi/VkOgegleb9A/0.jpg)](https://www.youtube.com/watch?v=VkOgegleb9A)

- 🖼️ **Pitch Deck**: https://drive.google.com/file/d/1CT2iNDgmdkfkzFDfRYTxZZYAcNdY7QP0/view

## 👨‍💻 Team

| Name | Role | GitHub                                                     |
| ---- | ---- | ---------------------------------------------------------- |
| Mark Hugh Neri | CTO | [@kimerran](https://github.com/kimerran)                   |
| Mycal Pejana | Smart Contract Dev | [@SaltinStillWaters](https://github.com/SaltinStillWaters) |
| Carl Macabales | AI Developer | [@cemmacabales](https://github.com/cemmacabales)           |               |

## 📜 License

MIT

---

## Developer reference


### Stack at a glance

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

### Local services map

| Service  | Port(s)     | Notes                                                |
| -------- | ----------- | ---------------------------------------------------- |
| Next.js  | 3000        | `pnpm dev`                                           |
| Postgres | 5432        | `pinkraft / pinkraft / pinkraft`                     |
| Redis    | 6379        | —                                                    |
| MinIO    | 9000 / 9001 | console at `:9001`, `pinkraft / pinkraft-dev-secret` |

> **Email** (Resend) and **AI** (Groq) are cloud services, not local containers — set their API keys to enable, leave them unset to degrade to dev-console logs / disabled features.

### Scripts

#### App

| Script           | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Next.js dev server with HMR                  |
| `pnpm build`     | `prisma generate && next build`              |
| `pnpm start`     | `prisma migrate deploy && next start` (prod) |
| `pnpm typecheck` | `tsc --noEmit`                               |
| `pnpm lint`      | `next lint`                                  |
| `pnpm format`    | Prettier across the repo                     |

#### Tests

| Script                    | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `pnpm test`               | Vitest unit suite (one-shot)                     |
| `pnpm test:watch`         | Vitest in watch mode                             |
| `pnpm test:e2e`           | Playwright end-to-end                            |
| `pnpm screenshots`        | Regenerate desktop screenshots in `screenshots/` |
| `pnpm screenshots:mobile` | Regenerate mobile screenshots                    |

#### Database

| Script                   | Purpose                              |
| ------------------------ | ------------------------------------ |
| `pnpm db:generate`       | Regenerate Prisma Client             |
| `pnpm db:migrate`        | Create + apply a new migration (dev) |
| `pnpm db:migrate:deploy` | Apply pending migrations (CI / prod) |
| `pnpm db:seed`           | Run `prisma/seed.ts`                 |
| `pnpm db:studio`         | Open Prisma Studio                   |

#### Contracts (Soroban)

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

#### Docker

| Script             | Purpose                               |
| ------------------ | ------------------------------------- |
| `pnpm docker:up`   | Start all services (`--profile full`) |
| `pnpm docker:down` | Stop services **and wipe volumes**    |

### Project layout

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
docs/            Pitch deck, mainnet runbook, features changelog
```

### Branching & CI

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

### Environment variables

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

### Deployment infrastructure

Configured for **Railway** (`railway.toml`, `nixpacks.toml`):

- `pnpm build` produces the standalone Next.js bundle.
- `pnpm start` runs `prisma migrate deploy` before booting `next start`.
- File storage swaps from MinIO to a Railway Volume via `FILE_STORAGE_DRIVER`.
- Stellar network pinned per environment via `STELLAR_NETWORK` (staging → `testnet`, production → `mainnet`). See [`docs/mainnet-cutover.md`](./docs/mainnet-cutover.md) for the cutover runbook.

### Further reading

- [`SPEC.md`](./SPEC.md) — full product + architecture spec (~1k lines)
- [`docs/features.md`](./docs/features.md) — running changelog of user-visible features
- [`docs/soroban-smart-contracts.md`](./docs/soroban-smart-contracts.md) — contract API surface
- [`docs/mainnet-cutover.md`](./docs/mainnet-cutover.md) — mainnet-go-live runbook
