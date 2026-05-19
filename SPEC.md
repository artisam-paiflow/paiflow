# Pink Raft — Specification

> **"Zaps for money"** — a visual builder where users connect triggers ("when this happens") to actions ("pay this") and deploy a live Soroban contract on the Stellar network in under a minute.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [System Architecture](#3-system-architecture)
4. [Domain Model & Database Schema](#4-domain-model--database-schema)
5. [Soroban Smart Contracts](#5-soroban-smart-contracts)
6. [Block Library (Visual Builder Primitives)](#6-block-library-visual-builder-primitives)
7. [Pages / Routes (Frontend)](#7-pages--routes-frontend)
8. [API Endpoints (Backend)](#8-api-endpoints-backend)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Wallet & On-Chain Integration](#10-wallet--on-chain-integration)
11. [Real-Time Event Feed](#11-real-time-event-feed)
12. [Third-Party Services](#12-third-party-services)
13. [Security & Application Best Practices](#13-security--application-best-practices)
14. [Local Development Configuration](#14-local-development-configuration)
15. [Deployment (Railway)](#15-deployment-railway)
16. [Demo Script (The "Wow" Moment)](#16-demo-script-the-wow-moment)
17. [Out of Scope (v1)](#17-out-of-scope-v1)

---

## 1. Product Overview

### 1.1 Problem

Every fintech and SMB that wants **programmable payments** must hire a Rust developer or pick from off-the-shelf SaaS. There is no middle layer.

### 1.2 Solution

Pink Raft is the missing middle layer:

- Drag triggers (`On Receive`, `On Schedule`) onto a canvas.
- Drop actions (`Pay`, `Split`) and optional logic (`Condition`).
- Click **Deploy** — a pre-audited Soroban contract template is instantiated on Stellar with user parameters.
- Show a QR code; anyone can send testnet (or live) funds.
- A live event feed animates the contract's execution in real time.

### 1.3 Hero Demo Beat

> Presenter drags **`On Receive USDC` → `Split 60/30/10` → `[Alice, Bob, Charlie]`** on a phone. Hits **Deploy**. QR code appears. Audience member scans, sends 10 testnet USDC. Within 5 seconds, three transactions fan out on the explorer projected on screen.

### 1.4 Non-Goals (v1)

- Multi-tenant org/team management beyond admin + user accounts.
- A general-purpose Soroban IDE (we only ship 3 templates).
- Mainnet deployments by default (testnet only; mainnet behind feature flag).
- Mobile native app (the web app must be fully responsive for mobile demo).

---

## 2. Tech Stack & Dependencies

All versions reflect the latest stable releases as of the build date. Lock with `pnpm` and `pnpm-lock.yaml`.

### 2.1 Runtime & Tooling

| Tool             | Version                 | Notes                             |
| ---------------- | ----------------------- | --------------------------------- |
| Node.js          | `>=22.11 <23` LTS (Jod) | `engines` field in `package.json` |
| pnpm             | `>=10.0`                | enforced via `packageManager`     |
| TypeScript       | `^5.7`                  | `strict: true`                    |
| Docker / Compose | `>=27 / v2.30`          | local dev only                    |

### 2.2 Application Stack

| Package                   | Version           | Purpose                                                         |
| ------------------------- | ----------------- | --------------------------------------------------------------- |
| `next`                    | `^15.1`           | Frontend & backend (App Router, Server Actions, Route Handlers) |
| `react` / `react-dom`     | `^19.0`           | UI                                                              |
| `tailwindcss`             | `^4.0`            | Styling (new CSS-first engine)                                  |
| `@tailwindcss/postcss`    | `^4.0`            | PostCSS plugin                                                  |
| `shadcn/ui`               | latest (copy-in)  | Component primitives (Radix + Tailwind)                         |
| `@xyflow/react`           | `^12.4`           | Drag-drop canvas (formerly `reactflow`)                         |
| `lucide-react`            | `^0.469`          | Icons                                                           |
| `framer-motion`           | `^11.15`          | Animated arrows on canvas                                       |
| `zustand`                 | `^5.0`            | Client state for builder canvas                                 |
| `@tanstack/react-query`   | `^5.62`           | Server state / RPC polling fallback                             |
| `react-hook-form` + `zod` | `^7.54` / `^3.24` | Forms & validation                                              |
| `qrcode.react`            | `^4.2`            | QR for SEP-7 payment URI                                        |
| `sonner`                  | `^1.7`            | Toast notifications                                             |

### 2.3 Data & Auth

| Package                     | Version          | Purpose                                      |
| --------------------------- | ---------------- | -------------------------------------------- |
| `prisma` / `@prisma/client` | `^6.1`           | ORM, migrations, seed                        |
| `pg`                        | `^8.13`          | Postgres driver (for Prisma)                 |
| `next-auth` (Auth.js)       | `^5.0.0-beta.25` | Session-based auth with Credentials provider |
| `@auth/prisma-adapter`      | `^2.7`           | Persists Auth.js sessions in Postgres        |
| `argon2`                    | `^0.41`          | Password hashing (preferred over bcrypt)     |
| `@simplewebauthn/server`    | `^11.0`          | Passkey registration & assertion (server)    |
| `@simplewebauthn/browser`   | `^11.0`          | Passkey ceremonies (client)                  |
| `ioredis`                   | `^5.4`           | Rate-limit & event stream cache              |

### 2.4 Stellar / Soroban

| Package                           | Version      | Purpose                                                       |
| --------------------------------- | ------------ | ------------------------------------------------------------- |
| `@stellar/stellar-sdk`            | `^13.1`      | RPC client, transaction builder, Soroban contract invocation  |
| `@stellar/freighter-api`          | `^4.1`       | Freighter wallet connector (easy-path)                        |
| `@creit.tech/stellar-wallets-kit` | `^1.7`       | Multi-wallet adapter (Freighter, xBull, Albedo, Hana, LOBSTR) |
| `@stellar/stellar-base`           | (transitive) | XDR primitives                                                |

### 2.5 Observability & Quality

| Package                                    | Version           | Purpose                                           |
| ------------------------------------------ | ----------------- | ------------------------------------------------- |
| `pino` + `pino-pretty`                     | `^9.5` / `^13.0`  | Structured logging                                |
| `@sentry/nextjs`                           | `^8.47`           | Error reporting (optional, gated by `SENTRY_DSN`) |
| `eslint` + `eslint-config-next`            | `^9.17` / `^15.1` | Lint                                              |
| `prettier` + `prettier-plugin-tailwindcss` | `^3.4`            | Format                                            |
| `vitest`                                   | `^2.1`            | Unit tests                                        |
| `@playwright/test`                         | `^1.49`           | E2E (deploy → fund → see fan-out)                 |
| `husky` + `lint-staged`                    | `^9.1` / `^15.3`  | Pre-commit hooks                                  |

### 2.6 Soroban Contract Toolchain (separate workspace, not shipped in Node app)

| Tool                  | Version        | Purpose                       |
| --------------------- | -------------- | ----------------------------- |
| Rust (rustup)         | `1.83+` stable | Compile contracts             |
| `cargo-binstall`      | latest         | Tool installs                 |
| `stellar-cli`         | `^22.0`        | Build, deploy, invoke from CI |
| `soroban-sdk` (crate) | `^22.0`        | Contract SDK                  |

---

## 3. System Architecture

```
                 ┌──────────────────────────────────────────────────────┐
                 │                       Browser                        │
                 │  Next.js App Router (React 19, Tailwind 4, React     │
                 │  Flow). Wallet Kit talks directly to extension &     │
                 │  signs transactions client-side.                     │
                 └──────────────┬───────────────────────────────────────┘
                                │ HTTPS (cookies: __Host-pinkraft.session)
                 ┌──────────────▼───────────────────────────────────────┐
                 │              Next.js Route Handlers / RSC            │
                 │  - REST under /api/*                                 │
                 │  - SSE under /api/contracts/[id]/events              │
                 │  - Server Actions for form submits                   │
                 │  Auth.js (Credentials + Passkey). Argon2id hashes.   │
                 └─┬──────────┬────────────────┬─────────────┬──────────┘
                   │          │                │             │
            ┌──────▼───┐  ┌───▼────┐  ┌────────▼──────┐ ┌────▼─────────┐
            │ Postgres │  │ Redis  │  │ Stellar RPC   │ │ Railway      │
            │ (Railway)│  │(rate-  │  │ Horizon + Soro│ │ Volume       │
            │  Prisma  │  │ limit  │  │ ban RPC       │ │ (file svc)   │
            │  schema  │  │ + SSE  │  │ (testnet by   │ │ avatars,     │
            │          │  │ pub/sub│  │  default)     │ │ exports      │
            └──────────┘  └────────┘  └───────────────┘ └──────────────┘
                                              │
                                ┌─────────────▼──────────────┐
                                │ Pre-deployed WASM hashes:  │
                                │  - splitter.wasm           │
                                │  - streamer.wasm           │
                                │  - conditional.wasm        │
                                │ (uploaded once to network) │
                                └────────────────────────────┘
```

### 3.1 Key Architectural Decisions

- **Pre-deployed WASM**: All three Soroban templates are compiled & uploaded once at bootstrap. The "Deploy" button only **instantiates** (creates a contract instance from an existing WASM hash) and **initializes** it with user parameters. This eliminates Rust-toolchain dependencies from the request path and removes a huge class of audit risk.
- **Client-signed transactions**: Pink Raft **never** holds user private keys. The Next.js backend builds the XDR; the user signs in their wallet; the backend submits the signed envelope.
- **SSE over WebSocket**: Server-Sent Events are simpler, work over plain HTTP/2, and survive Railway's load balancer without sticky sessions. Used for the live event feed.
- **No background worker process (v1)**: A single Next.js service polls Soroban RPC events on a setInterval inside a route handler invoked by Vercel-style cron (Railway cron) every 15s, persists deltas to Postgres, and fans them out to subscribed SSE clients via Redis pub/sub.

---

## 4. Domain Model & Database Schema

Postgres 16, accessed via Prisma 6. Use UUIDv7 IDs (`@default(dbgenerated("uuidv7()"))` with the `uuid-ossp`/`pg_uuidv7` extension) for sortable primary keys.

```prisma
// schema.prisma (excerpt)
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  USER
}

enum TemplateKind {
  SPLITTER
  STREAMER
  CONDITIONAL
}

enum DeploymentStatus {
  DRAFT
  BUILDING
  PENDING_SIGNATURE
  SUBMITTED
  CONFIRMED
  FAILED
}

enum EventKind {
  RECEIVE
  PAYOUT
  CLAIM
  STATUS_CHANGE
}

model User {
  id              String       @id @default(dbgenerated("uuidv7()")) @db.Uuid
  username        String       @unique
  email           String?      @unique
  passwordHash    String       // argon2id
  role            Role         @default(USER)
  isActive        Boolean      @default(true)
  failedLogins    Int          @default(0)
  lockedUntil     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  lastLoginAt     DateTime?

  flows           Flow[]
  deployments     Deployment[]
  passkeys        Passkey[]
  sessions        Session[]
  auditLogs       AuditLog[]
}

// Auth.js sessions persisted via @auth/prisma-adapter
model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String   @db.Uuid
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Passkey {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId          String   @db.Uuid
  credentialId    Bytes    @unique
  publicKey       Bytes
  counter         BigInt   @default(0)
  deviceType      String   // "singleDevice" | "multiDevice"
  backedUp        Boolean
  transports      String[] // ["internal","hybrid",...]
  nickname        String?
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// A Flow = the saved canvas (graph of blocks + edges)
model Flow {
  id          String        @id @default(dbgenerated("uuidv7()")) @db.Uuid
  ownerId     String        @db.Uuid
  name        String
  description String?
  templateKind TemplateKind
  // The visual graph; validated by Zod before persist
  graph       Json          // { nodes: [...], edges: [...] }
  // Parameters extracted from graph, ready to pass to contract __init
  parameters  Json          // { recipients: [...], asset: "USDC", ... }
  version     Int           @default(1)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  owner       User          @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  deployments Deployment[]

  @@index([ownerId, updatedAt(sort: Desc)])
}

model ContractTemplate {
  id          String       @id @default(dbgenerated("uuidv7()")) @db.Uuid
  kind        TemplateKind @unique
  // The WASM hash uploaded to Stellar (hex). The deploy step instantiates by hash.
  wasmHash    String
  network     String       // "testnet" | "mainnet"
  abiJson     Json         // parsed contract spec for UI validation
  uploadedAt  DateTime     @default(now())
}

model Deployment {
  id              String           @id @default(dbgenerated("uuidv7()")) @db.Uuid
  flowId          String           @db.Uuid
  ownerId         String           @db.Uuid
  network         String           // "testnet" | "mainnet"
  contractAddress String?          @unique // C... once confirmed
  deployTxHash    String?          @unique
  status          DeploymentStatus @default(DRAFT)
  errorMessage    String?
  // Snapshot of graph + parameters at deploy time (immutable history)
  graphSnapshot   Json
  paramsSnapshot  Json
  createdAt       DateTime         @default(now())
  confirmedAt     DateTime?

  flow            Flow             @relation(fields: [flowId], references: [id], onDelete: Restrict)
  owner           User             @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  events          ContractEvent[]
  cursor          EventCursor?

  @@index([ownerId, createdAt(sort: Desc)])
  @@index([status])
}

model ContractEvent {
  id              String     @id @default(dbgenerated("uuidv7()")) @db.Uuid
  deploymentId    String     @db.Uuid
  kind            EventKind
  ledger          Int
  txHash          String
  // For RECEIVE: who sent, what asset, amount.
  // For PAYOUT/CLAIM: who received, amount.
  payload         Json
  occurredAt      DateTime

  deployment      Deployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)

  @@unique([txHash, kind])
  @@index([deploymentId, occurredAt(sort: Desc)])
}

// Tracks pagination cursor for Soroban event polling per deployment.
model EventCursor {
  deploymentId    String     @id @db.Uuid
  lastLedger      Int
  lastPagingToken String?
  updatedAt       DateTime   @updatedAt
  deployment      Deployment @relation(fields: [deploymentId], references: [id], onDelete: Cascade)
}

model AuditLog {
  id        String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId    String?  @db.Uuid
  action    String   // "USER_LOGIN", "FLOW_CREATE", "DEPLOY_SUBMIT", ...
  ip        String?
  userAgent String?
  metadata  Json?
  createdAt DateTime @default(now())

  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
}

model RateLimitBucket {
  // Optional fallback if Redis is unavailable. Mostly Redis-backed.
  key       String   @id
  count     Int
  resetAt   DateTime
}
```

### 4.1 Seed Script (`prisma/seed.ts`)

Seeds:

1. One admin user (`admin` / password from env `ADMIN_SEED_PASSWORD`, required at seed time; refuse to seed with default in non-dev environments).
2. Three `ContractTemplate` rows — each row is **upserted** with the WASM hash from `STELLAR_WASM_HASH_SPLITTER`, `..._STREAMER`, `..._CONDITIONAL` env vars (produced by `scripts/upload-wasm.ts`).
3. A demo flow for the admin in development only (`NODE_ENV !== "production"`).

The seed must:

- Hash the admin password with argon2id (`memoryCost: 19456, timeCost: 2, parallelism: 1` — OWASP 2024 minimum).
- Be idempotent (upsert).
- Refuse to run twice in `production` unless `ALLOW_RESEED=true`.

---

## 5. Soroban Smart Contracts

Three audited, parameterizable Rust contracts. Source lives under `contracts/` workspace. Pre-built WASMs are uploaded once per network; the app instantiates by `wasm_hash`.

### 5.1 `splitter` — hero contract

- **Storage**:
  - `admin: Address`
  - `asset: Address` (Soroban Asset Contract address — for USDC use the SAC of the trusted asset)
  - `recipients: Vec<(Address, u32)>` where the u32 is basis points (0..=10_000), must sum to 10_000.
  - `paused: bool`
- **Functions**:
  - `__init(admin, asset, recipients)` — checked once.
  - `distribute(amount: i128)` — pulls `amount` of `asset` from `env.invoker()`, fans out to each recipient pro-rata. Reverts if `paused`. Emits `Distributed{ payer, asset, amount, payouts }`.
  - `pause()` / `unpause()` — admin only.
  - `recipients()` view.
- **Invariant**: sum(bps) == 10_000; rounding remainder goes to the **last recipient** (documented).

### 5.2 `streamer`

- **Storage**: `admin`, `recipient`, `asset`, `rate_per_second: i128`, `start_ts`, `end_ts`, `claimed: i128`.
- **Functions**:
  - `__init(admin, recipient, asset, rate, start_ts, end_ts)`
  - `claim()` — recipient-only; computes `vested = min(now,end) - max(start, last_claim) * rate`; transfers `vested - claimed`.
  - `top_up(amount)` — admin can deposit more funds.
  - `cancel()` — admin only; refunds remainder.
  - `available()` view.

### 5.3 `conditional`

- **Storage**: `admin`, `recipient`, `asset`, `amount`, `condition: ConditionKind`, `released: bool`.
- `ConditionKind` enum: `Timeout(u64)` | `OracleGte { oracle: Address, key: Symbol, threshold: i128 }` | `Multisig { signers: Vec<Address>, threshold: u32 }`.
- **Functions**: `__init`, `release()`, `cancel()`, `status()`.

### 5.4 Build & Upload Pipeline

- `pnpm contracts:build` → `stellar contract build` → `target/wasm32v1-none/release/*.wasm`.
- `pnpm contracts:optimize` → `stellar contract optimize`.
- `pnpm contracts:upload --network=testnet` → uploads each WASM, writes hashes into `.env.contracts` (consumed by app and seed).
- All three contracts must include `#[contracttype]` events so the indexer can read them.

### 5.5 Security Notes (Contracts)

- All numeric arithmetic uses `i128` with checked ops (`checked_add`, `checked_mul`) — no silent overflow.
- Reentrancy: Soroban's invocation model + single-threaded VM mitigates classical reentrancy; still, **effects-before-interactions** ordering is enforced.
- Address authorization: every call that mutates state requires `recipient.require_auth()` or `admin.require_auth()`.
- Templates are version-pinned (a `version: Symbol` storage key) so the indexer can decode events safely after future upgrades.

---

## 6. Block Library (Visual Builder Primitives)

Exactly five blocks. Each block has a strict TypeScript schema validated by Zod on save and again server-side at deploy time.

### 6.1 Triggers

- **`on_receive`** — fires when the contract receives `asset`.
  - Config: `asset: enum("XLM","USDC","custom")`, `customAssetCode?`, `customAssetIssuer?`.
- **`on_schedule`** — fires every `interval`.
  - Config: `interval: enum("minute","hour","day")`, `startsAt: ISODate`, `endsAt?: ISODate`.

### 6.2 Actions

- **`pay`** — send fixed amount to one address.
  - Config: `recipient: StellarAddress`, `amount: stroops(i128)`, `asset` (same shape as trigger).
- **`split`** — fan out incoming amount by percentage.
  - Config: `recipients: Array<{ address: StellarAddress, bps: 1..10_000, label?: string }>` (must sum to 10_000), `asset`.

### 6.3 Logic

- **`condition`** — gates downstream blocks.
  - Config: `kind: enum("amount_gt","amount_lt","oracle_gte","time_after","time_before")` + kind-specific fields.

### 6.4 Validation Rules

- Exactly one trigger (root) per flow.
- A flow must terminate in at least one action.
- Edges flow trigger → (condition?) → action; no cycles (Zod refine + DAG check).
- `templateKind` is inferred from the graph:
  - `[on_receive] → [split]` → **SPLITTER**
  - `[on_schedule] → [pay]` → **STREAMER**
  - `[on_receive|on_schedule] → [condition] → [pay|split]` → **CONDITIONAL**

### 6.5 English Preview Pane

A pure function `flowToEnglish(graph): string` renders the canvas into natural language for non-technical judges:

> "When this contract receives **USDC**, split **60%** to `GABC…XYZ`, **30%** to `GDEF…UVW`, **10%** to `GHIJ…RST`."

---

## 7. Pages / Routes (Frontend)

Next.js App Router (`/app/...`). Server Components by default; mark interactive nodes `"use client"`.

| Path                                | Description                                                                                                      | Auth                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/`                                 | Marketing landing — hero, three-step demo GIF, CTA → `/login`.                                                   | public                                                 |
| `/login`                            | Username + password form. Includes "Sign in with Passkey" button.                                                | public                                                 |
| `/register`                         | Self-serve registration (feature-flagged via `ALLOW_PUBLIC_REGISTRATION`). Default: off; users created by admin. | public if flag                                         |
| `/forgot-password`                  | (v1.1)                                                                                                           | public                                                 |
| `/dashboard`                        | List of flows + deployments, "New flow" CTA, account balance hint.                                               | user                                                   |
| `/flows/new`                        | Empty canvas.                                                                                                    | user                                                   |
| `/flows/[flowId]`                   | Edit canvas. Auto-saves graph every 1.5s (debounced).                                                            | owner                                                  |
| `/flows/[flowId]/deploy`            | Deploy modal: review English preview, choose network, click **Deploy** → wallet signs → status stream.           | owner                                                  |
| `/deployments/[deploymentId]`       | Live view: contract address, QR code, SEP-7 URI, animated event feed overlaid on the canvas.                     | owner                                                  |
| `/deployments/[deploymentId]/embed` | A public read-only embed of the deployment (for demo projection).                                                | public, but only renders status / events; no controls. |
| `/account`                          | Change password, manage passkeys, sessions list, log out everywhere.                                             | user                                                   |
| `/admin`                            | Admin dashboard: users, deployments across all users, audit log.                                                 | admin                                                  |
| `/admin/users`                      | CRUD users, reset passwords (one-time link).                                                                     | admin                                                  |
| `/admin/templates`                  | View deployed WASM hashes per network. Re-upload via signed CLI flow.                                            | admin                                                  |
| `/api/health`                       | Liveness + readiness.                                                                                            | public                                                 |
| `/about`, `/privacy`, `/terms`      | Static MDX.                                                                                                      | public                                                 |

### 7.1 Builder Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Top bar:  [Pink Raft]  flow-name (editable)  [Deploy]  [Avatar] │
├─────────┬─────────────────────────────────────┬────────────────┤
│ Block   │                                     │ Config panel   │
│ palette │           React Flow canvas         │ (selected      │
│ (drag   │  ▢ on_receive ─▶ ▢ split ─▶ {Alice,…} │  block fields) │
│  source)│                                     │                │
│         │                                     │ ──────────────  │
│         │                                     │ English preview│
│         │                                     │ pane (sticky)  │
└─────────┴─────────────────────────────────────┴────────────────┘
```

---

## 8. API Endpoints (Backend)

All endpoints under `/api/*` are Next.js Route Handlers in `app/api/.../route.ts`. Request and response bodies are validated with Zod. All mutating endpoints require an authenticated session and a CSRF double-submit token (Auth.js provides this).

### 8.1 Auth

| Method | Path                                 | Body / Query             | Response         | Notes                                     |
| ------ | ------------------------------------ | ------------------------ | ---------------- | ----------------------------------------- |
| POST   | `/api/auth/[...nextauth]`            | (Auth.js)                | (Auth.js)        | Credentials provider                      |
| POST   | `/api/auth/register`                 | `{ username, password }` | `201 { id }`     | 422 if validation fails; rate-limited     |
| POST   | `/api/auth/passkey/register/options` | —                        | WebAuthn options | session required                          |
| POST   | `/api/auth/passkey/register/verify`  | `attestationResponse`    | `{ ok }`         | session required                          |
| POST   | `/api/auth/passkey/login/options`    | `{ username? }`          | options          | public                                    |
| POST   | `/api/auth/passkey/login/verify`     | `assertion`              | sets session     | public                                    |
| POST   | `/api/auth/logout`                   | —                        | `204`            | clears session                            |
| POST   | `/api/auth/sessions/revoke-all`      | —                        | `204`            | invalidates all sessions for current user |

### 8.2 Flows

| Method | Path                      | Body                | Response                                                     |
| ------ | ------------------------- | ------------------- | ------------------------------------------------------------ |
| GET    | `/api/flows`              | `?cursor&limit`     | `{ items: Flow[], nextCursor }`                              |
| POST   | `/api/flows`              | `{ name, graph }`   | `201 Flow`                                                   |
| GET    | `/api/flows/:id`          | —                   | `Flow`                                                       |
| PATCH  | `/api/flows/:id`          | `{ name?, graph? }` | `Flow` (validates graph; computes parameters & templateKind) |
| DELETE | `/api/flows/:id`          | —                   | `204`                                                        |
| POST   | `/api/flows/:id/validate` | —                   | `{ ok, errors? }` (server-side Zod + DAG check)              |
| POST   | `/api/flows/:id/preview`  | —                   | `{ english: string }`                                        |

### 8.3 Deployments

| Method | Path                          | Body                                 | Response                                                                                |
| ------ | ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| GET    | `/api/deployments`            | `?cursor&limit&flowId&status`        | paginated list                                                                          |
| POST   | `/api/deployments/prepare`    | `{ flowId, network, sourceAccount }` | `{ deploymentId, xdr, sorobanData, deployFootprint }` — unsigned XDR for client to sign |
| POST   | `/api/deployments/:id/submit` | `{ signedXdr }`                      | `{ status, txHash }` — backend submits to Soroban RPC                                   |
| GET    | `/api/deployments/:id`        | —                                    | `Deployment`                                                                            |
| GET    | `/api/deployments/:id/events` | (SSE)                                | text/event-stream of `ContractEvent`                                                    |
| GET    | `/api/deployments/:id/qr`     | `?size&format=svg                    | png`                                                                                    | image | computes SEP-7 URI server-side; URI is also returned in JSON form for copy |
| GET    | `/api/deployments/:id/sep7`   | —                                    | `{ uri }`                                                                               |

### 8.4 Internal / Operational

| Method | Path                             | Auth                                 | Notes                                                                                                                                               |
| ------ | -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/cron/poll-events`          | Cron secret header (`X-Cron-Secret`) | Polls Soroban RPC for new events for all `CONFIRMED` deployments, persists to `ContractEvent`, publishes to Redis. Runs every 15s via Railway cron. |
| POST   | `/api/cron/finalize-deployments` | Cron secret                          | For `SUBMITTED` deployments older than 30s, checks tx status, updates to `CONFIRMED` / `FAILED`.                                                    |
| GET    | `/api/health`                    | public                               | `{ status, db, redis, rpc }`                                                                                                                        |
| GET    | `/api/admin/audit-log`           | admin                                | paginated audit entries                                                                                                                             |
| GET    | `/api/admin/users`               | admin                                | list, search                                                                                                                                        |
| POST   | `/api/admin/users`               | admin                                | create user                                                                                                                                         |
| PATCH  | `/api/admin/users/:id`           | admin                                | activate/deactivate, role, reset password                                                                                                           |

### 8.5 Response Conventions

- JSON envelope: `{ data: T }` on success, `{ error: { code, message, fields? } }` on failure.
- Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `UPSTREAM_RPC`, `INTERNAL`.
- All list endpoints use **cursor pagination** (`uuidv7` ordered).
- Timestamps are ISO-8601 UTC.

---

## 9. Authentication & Authorization

### 9.1 Primary: username + password (required by brief)

- Auth.js v5 Credentials provider.
- Argon2id hashing (`memoryCost: 19456 KiB, timeCost: 2, parallelism: 1`).
- Lockout: 5 failed attempts → 15-minute lock (`User.lockedUntil`). Counter resets on success.
- Passwords:
  - Minimum 12 characters.
  - Validate against the [HIBP k-anonymity API](https://haveibeenpwned.com/API/v3#PwnedPasswords) at registration (optional; gated by env, fail-open on upstream error).
  - Reject if username appears as a substring (case-insensitive).
- Session: JWT **encrypted** (JWE) in an `__Host-pinkraft.session` cookie. `HttpOnly`, `Secure`, `SameSite=Lax`. 7-day lifetime, sliding refresh.

### 9.2 Optional: Passkey ("wow path")

- WebAuthn via `@simplewebauthn/*`.
- `rpId = process.env.AUTH_RP_ID` (e.g., `pinkraft.app`).
- Stored per-user in `Passkey` table. Counter incremented on assertion to defeat clones.
- Users may register additional devices. A user with **only** passkeys still has a password (the brief requires "basic username and password" baseline).

### 9.3 Authorization

- Two roles: `ADMIN`, `USER`.
- Route protection via a `requireSession(role?)` helper used in every Route Handler and Server Action.
- Ownership checks: every flow/deployment endpoint verifies `resource.ownerId === session.user.id` unless role is `ADMIN`.
- Admin actions are double-confirmed in UI and emit an `AuditLog` entry.

### 9.4 CSRF

- Auth.js v5's built-in double-submit pattern for all `POST/PATCH/DELETE`. Server Actions are CSRF-safe by default (signed action ID).

### 9.5 Seeded Admin

- Username: `admin`.
- Password: from env `ADMIN_SEED_PASSWORD` (required; no default). Seed exits non-zero if missing.

---

## 10. Wallet & On-Chain Integration

### 10.1 Wallet Connection

- Default connector: **Stellar Wallets Kit** (covers Freighter, xBull, Albedo, Hana, LOBSTR, WalletConnect).
- The wallet's public key is stored only in client state, not in the DB (no custody).

### 10.2 Deploy Flow (sequence)

```
Client                              Server                       Stellar
  │  POST /flows/:id/validate         │                            │
  │ ─────────────────────────────────▶│ (Zod + DAG check)          │
  │                                   │                            │
  │  POST /deployments/prepare        │                            │
  │  { flowId, network, sourceAccount}│                            │
  │ ─────────────────────────────────▶│                            │
  │                                   │ Load ContractTemplate      │
  │                                   │  by templateKind+network.  │
  │                                   │ Build CreateContract op    │
  │                                   │  using wasmHash + init     │
  │                                   │  args derived from params. │
  │                                   │ Fetch source account seq.  │
  │                                   │ Simulate tx via Soroban    │
  │                                   │  RPC → footprint+fee.      │
  │                                   │ Persist Deployment (DRAFT  │
  │                                   │  → PENDING_SIGNATURE).     │
  │  { deploymentId, xdr }            │                            │
  │ ◀──────────────────────────────── │                            │
  │                                   │                            │
  │  walletKit.signTransaction(xdr)   │                            │
  │ (user approves in extension)      │                            │
  │                                   │                            │
  │  POST /deployments/:id/submit     │                            │
  │  { signedXdr }                    │                            │
  │ ─────────────────────────────────▶│                            │
  │                                   │ sendTransaction →          │
  │                                   │ ──────────────────────────▶│
  │                                   │ poll getTransaction        │
  │                                   │  until SUCCESS/FAILED.     │
  │                                   │ derive contractAddress     │
  │                                   │  from `created` resource.  │
  │                                   │ status=CONFIRMED, persist  │
  │  { contractAddress, txHash }      │                            │
  │ ◀──────────────────────────────── │                            │
  │                                   │                            │
  │  EventSource /events (SSE)        │                            │
  │ ─────────────────────────────────▶│ (Redis subscribe)          │
```

### 10.3 SEP-7 Payment URI

- Format: `web+stellar:pay?destination=<C-address>&asset_code=USDC&asset_issuer=<G-issuer>&amount=<optional>&memo=<optional>&msg=...`.
- For Soroban contracts on testnet, generate a QR that opens this in any SEP-7-compatible wallet.
- A copy button exposes the raw URI for terminals without QR.

### 10.4 RPC Endpoints (env)

- `STELLAR_HORIZON_URL_TESTNET=https://horizon-testnet.stellar.org`
- `STELLAR_SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org`
- `STELLAR_NETWORK_PASSPHRASE_TESTNET="Test SDF Network ; September 2015"`
- Mainnet equivalents behind feature flag `ENABLE_MAINNET=false` by default.

---

## 11. Real-Time Event Feed

### 11.1 Polling worker (`/api/cron/poll-events`)

- Runs every **15 seconds** (Railway cron).
- For each `CONFIRMED` deployment:
  1. Read `EventCursor.lastLedger`.
  2. Call Soroban RPC `getEvents` filtered by `contractIds=[contractAddress]` from `lastLedger+1`.
  3. Decode using stored `ContractTemplate.abiJson`.
  4. Persist new `ContractEvent` rows (idempotent on `(txHash, kind)` unique).
  5. Publish to Redis channel `events:<deploymentId>`.
  6. Advance cursor.

### 11.2 SSE handler (`/api/deployments/:id/events`)

- Subscribes to Redis channel.
- On open, replays the last 50 events from Postgres so reloads catch up.
- Sends `event: ping\ndata: {}` every 25s (heartbeat).
- Closes when client disconnects; cleans up subscriber.

### 11.3 Animated canvas

- The deployment view re-renders the same React Flow canvas in read-only mode.
- Each `RECEIVE` event flashes the trigger node, then animates an arrow downstream.
- For `split`, three child arrows fan out simultaneously with amount labels.

---

## 12. Third-Party Services

| Service                              | Use                                                                 | Required | Env                               |
| ------------------------------------ | ------------------------------------------------------------------- | -------- | --------------------------------- |
| **Railway**                          | Hosting (Next.js app, Postgres plugin, Redis plugin, cron, volume)  | yes      | (managed)                         |
| **Railway Postgres**                 | Primary DB                                                          | yes      | `DATABASE_URL`                    |
| **Railway Redis**                    | Pub/sub + rate-limit                                                | yes      | `REDIS_URL`                       |
| **Railway Volume**                   | File storage (avatars, exported flow JSON) mounted at `/data/files` | yes      | `FILE_STORAGE_PATH=/data/files`   |
| **Stellar Horizon (testnet)**        | Account info, asset queries                                         | yes      | `STELLAR_HORIZON_URL_TESTNET`     |
| **Stellar Soroban RPC (testnet)**    | Contract simulate / submit / events                                 | yes      | `STELLAR_SOROBAN_RPC_URL_TESTNET` |
| **Stellar Friendbot**                | Fund testnet demo accounts in dev                                   | dev      | `STELLAR_FRIENDBOT_URL`           |
| **Stellar Wallets Kit** (client lib) | Wallet connect                                                      | yes      | n/a                               |
| **Have I Been Pwned API**            | Optional password check                                             | optional | (no key needed)                   |
| **Sentry**                           | Error tracking                                                      | optional | `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` |
| **Resend** (or Postmark)             | Transactional email for password reset (v1.1)                       | optional | `RESEND_API_KEY`                  |

> **File service note**: The brief specifies "File services: Use Railway". We use a Railway Volume mounted into the app at `/data/files` and front it with a server-only `app/api/files/[id]/route.ts` handler that streams files with `Content-Disposition` and an auth check. Local dev uses MinIO as a drop-in replacement (S3-compatible client wrapper makes the switch trivial if Railway adds object storage later).

---

## 13. Security & Application Best Practices

### 13.1 HTTP Hardening

- Strict CSP (no `unsafe-inline`; nonce-based for inline scripts that Next.js emits):
  ```
  default-src 'self';
  script-src 'self' 'nonce-<n>';
  style-src 'self' 'unsafe-inline'; /* Tailwind 4 inlines runtime CSS — pin to a nonce when stable */
  img-src 'self' data: blob:;
  connect-src 'self' https://*.stellar.org wss://*.stellar.org;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  ```
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` (passkey uses `publickey-credentials-get=(self)`)
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- Headers set via `next.config.ts` `headers()` and double-checked in `middleware.ts`.

### 13.2 Input Validation

- **Every** Route Handler parses its inputs with Zod (`request.json()` → `schema.parse()`).
- Stellar addresses validated via `StrKey.isValidEd25519PublicKey` / `StrKey.isValidContract`.
- Numeric amounts handled as `bigint` (or string at the wire) — never `number` — to avoid precision loss.

### 13.3 Output Encoding

- React escapes by default; never use `dangerouslySetInnerHTML` outside of MDX rendering with a sanitized pipeline (`rehype-sanitize`).
- File downloads always set `Content-Type` and `Content-Disposition: attachment; filename=...` with a safe filename.

### 13.4 Authentication Hardening

- Argon2id with parameters tuned to ≥ 50ms on the target hardware.
- Generic error messages: `"Invalid username or password"` regardless of which is wrong.
- Lockouts (see §9.1). Audit log entries for every login attempt (success and failure).
- Session rotation on privilege change (e.g., role escalation, password reset).
- "Sign out everywhere" deletes all `Session` rows for the user.

### 13.5 Authorization

- Default-deny: every handler starts with `const session = await requireSession()`.
- Ownership predicate: `await db.flow.findFirstOrThrow({ where: { id, ownerId: session.user.id } })`.
- Admin-only endpoints check `session.user.role === 'ADMIN'`.

### 13.6 Rate Limiting

- `ioredis` token bucket, applied in `middleware.ts`:
  - Per-IP global: 100 req / 10 s.
  - Per-user write: 30 req / minute on `POST|PATCH|DELETE`.
  - Auth endpoints: 10 req / 10 min / IP for `/api/auth/*`.
- Fallback to in-Postgres `RateLimitBucket` if Redis is unavailable; fail-closed on auth routes.

### 13.7 Secrets Management

- All secrets via Railway env vars; never committed.
- `.env.example` mirrors required keys with empty values.
- `dotenv-safe`-style boot check: app refuses to start if a required env var is missing (Zod-validated `env.ts` module).

### 13.8 Logging & Audit

- Pino structured logs to stdout (Railway captures).
- Redact `password`, `passwordHash`, `signedXdr`, `cookie`, `authorization` automatically.
- `AuditLog` rows for: login (success/fail), logout, user CRUD, flow CRUD, deploy submit, deploy confirm, deploy fail, passkey add/remove.

### 13.9 Dependency Hygiene

- `pnpm audit --prod` runs in CI; non-zero fails the build.
- Renovate config (`renovate.json`) for weekly minor/patch updates.
- `package.json` `"engines"` enforced via `engine-strict=true` in `.npmrc`.

### 13.10 Smart Contract Safety

- Three audited templates only — no user-generated Rust on the request path.
- All `__init` arguments validated server-side **and** in-contract (defense in depth).
- Splitter `recipients` count capped at 20 to bound transaction footprint.
- Mainnet gated by feature flag + per-user allowlist.

### 13.11 OWASP ASVS Quick Map

- A01 Broken Access Control → ownership predicates, default-deny.
- A02 Cryptographic Failures → argon2id, JWE sessions, HTTPS only.
- A03 Injection → Prisma parameterized queries; no raw SQL except in a single `safeRaw` helper that uses tagged templates.
- A04 Insecure Design → threat model in `docs/threats.md`.
- A05 Misconfiguration → `env.ts` validation, security headers in two places.
- A07 Auth Failures → lockout, generic errors, rate limit.
- A08 Software/Data Integrity → SRI for any external script (none in v1), pnpm lockfile committed.
- A09 Logging → audit log + Pino + Sentry.

---

## 14. Local Development Configuration

### 14.1 `docker-compose.yml` (dev only)

Services:

- `postgres:16-alpine` → exposes 5432.
- `redis:7-alpine` → exposes 6379.
- `minio:latest` (file storage, S3-compatible) → exposes 9000 (API) and 9001 (console). Volume mounted at `./.docker/minio`.
- `RESEND_API_KEY` (required, transactional email delivery framework for authentication, security alerts, and system notifications) → integrated directly via HTTPS API endpoints.

Profiles let devs start a minimal set:

```
docker compose --profile core up -d       # postgres + redis
docker compose --profile full up -d       # + minio + resend core components
```

### 14.2 `.env.example`

```dotenv
# ---- App ----
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOG_LEVEL=debug

# ---- Auth ----
AUTH_SECRET=                          # `openssl rand -base64 48`
AUTH_URL=http://localhost:3000
AUTH_RP_ID=localhost
AUTH_RP_NAME=Pink Raft
ALLOW_PUBLIC_REGISTRATION=false
ADMIN_SEED_PASSWORD=                  # required for `pnpm db:seed`

# ---- Database ----
DATABASE_URL=postgresql://pinkraft:pinkraft@localhost:5432/pinkraft?schema=public

# ---- Redis ----
REDIS_URL=redis://localhost:6379

# ---- File storage (dev = MinIO; prod = Railway Volume) ----
FILE_STORAGE_DRIVER=minio             # minio | volume
FILE_STORAGE_PATH=/data/files
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=pinkraft
MINIO_SECRET_KEY=pinkraft-dev-secret
MINIO_BUCKET=pinkraft-dev

# ---- Stellar ----
STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE_TESTNET="Test SDF Network ; September 2015"
STELLAR_HORIZON_URL_TESTNET=https://horizon-testnet.stellar.org
STELLAR_SOROBAN_RPC_URL_TESTNET=https://soroban-testnet.stellar.org
STELLAR_FRIENDBOT_URL=https://friendbot.stellar.org
ENABLE_MAINNET=false

# WASM hashes — populated by `pnpm contracts:upload` and committed to env (not source)
STELLAR_WASM_HASH_SPLITTER=
STELLAR_WASM_HASH_STREAMER=
STELLAR_WASM_HASH_CONDITIONAL=

# ---- Cron ----
CRON_SECRET=                           # required header for /api/cron/* in prod

# ---- Optional ----
SENTRY_DSN=
RESEND_API_KEY=
HIBP_CHECK_ENABLED=true
```

### 14.3 Scripts (`package.json`)

```jsonc
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start -p ${PORT:-3000}",
    "lint": "next lint",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts",
    "db:studio": "prisma studio",
    "contracts:build": "pnpm -C contracts build",
    "contracts:upload": "tsx scripts/upload-wasm.ts",
    "docker:up": "docker compose --profile full up -d",
    "docker:down": "docker compose down -v",
    "prepare": "husky",
  },
}
```

### 14.4 First-time setup

```bash
pnpm install
cp .env.example .env.local && $EDITOR .env.local   # set AUTH_SECRET, ADMIN_SEED_PASSWORD
pnpm docker:up
pnpm db:migrate
pnpm contracts:build && pnpm contracts:upload      # writes WASM hashes back to env
pnpm db:seed
pnpm dev
```

---

## 15. Deployment (Railway)

### 15.1 Services

- **`web`** — Next.js app. Build: `pnpm install --frozen-lockfile && pnpm db:generate && pnpm build`. Start: `pnpm db:migrate:deploy && pnpm start`. Health: `GET /api/health`.
- **`postgres`** — Railway managed Postgres plugin.
- **`redis`** — Railway managed Redis plugin.
- **`web-volume`** — 1 GB volume mounted at `/data/files`.
- **Cron** — Railway cron jobs (or single in-app scheduler) hitting:
  - `*/1 * * * * curl -H "X-Cron-Secret: $CRON_SECRET" $WEB_URL/api/cron/poll-events` (every 15s in practice; Railway cron supports per-minute, with the handler internally looping 4×)
  - `*/1 * * * * curl ... /api/cron/finalize-deployments`

### 15.2 Build & Deploy

- Connect GitHub repo to Railway; build uses `nixpacks` with Node 22 + pnpm.
- Migrations run automatically on deploy (`prisma migrate deploy` before `next start`).
- Zero-downtime: Railway's default rolling deploy.
- Promote → production: PR merge to `main` triggers build.

### 15.3 Secrets in Railway

Set all values from `.env.example` in the project's "Variables" page; mark `AUTH_SECRET`, `ADMIN_SEED_PASSWORD`, `CRON_SECRET`, `SENTRY_AUTH_TOKEN`, `MINIO_SECRET_KEY` as secrets (hidden).

### 15.4 Domain

- Custom domain `pinkraft.app` → Railway-managed TLS (Let's Encrypt).
- `AUTH_RP_ID=pinkraft.app`, `NEXT_PUBLIC_APP_URL=https://pinkraft.app`.

---

## 16. Demo Script (The "Wow" Moment)

1. Presenter opens `https://pinkraft.app` on a phone.
2. Logs in with passkey (Face ID).
3. Drags `On Receive USDC` → `Split` block.
4. Adds three recipients: `Alice 60%`, `Bob 30%`, `Charlie 10%`.
5. The English preview pane reads: _"When this contract receives USDC, split 60% to GABC…, 30% to GDEF…, 10% to GHIJ…."_
6. Hits **Deploy** → wallet pop-up → signs.
7. QR code + contract address appears.
8. Audience member scans QR with their wallet, sends 10 testnet USDC.
9. On the projector: trigger node flashes; arrows fan out; three payout rows appear in the live feed; on-chain explorer links shown.
10. Total time from "Drag" to "Done": **~90 seconds**.

---

## 17. Out of Scope (v1)

- Custom user-authored Soroban contracts.
- Team/org features beyond admin/user.
- Email-based password reset (v1.1).
- Mobile native app (PWA is acceptable; manifest included).
- Mainnet by default.
- Block library beyond the five primitives.
- Marketplace of community-shared flows.

---

## Appendix A — File / Folder Layout

```
pinkraft/
├── app/
│   ├── (marketing)/page.tsx
│   ├── (auth)/login/page.tsx
│   ├── (auth)/register/page.tsx
│   ├── (app)/dashboard/page.tsx
│   ├── (app)/flows/new/page.tsx
│   ├── (app)/flows/[flowId]/page.tsx
│   ├── (app)/flows/[flowId]/deploy/page.tsx
│   ├── (app)/deployments/[deploymentId]/page.tsx
│   ├── (app)/deployments/[deploymentId]/embed/page.tsx
│   ├── (app)/account/page.tsx
│   ├── (admin)/admin/page.tsx
│   ├── (admin)/admin/users/page.tsx
│   ├── (admin)/admin/templates/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── auth/register/route.ts
│   │   ├── auth/passkey/...
│   │   ├── flows/route.ts
│   │   ├── flows/[id]/route.ts
│   │   ├── flows/[id]/validate/route.ts
│   │   ├── flows/[id]/preview/route.ts
│   │   ├── deployments/route.ts
│   │   ├── deployments/prepare/route.ts
│   │   ├── deployments/[id]/route.ts
│   │   ├── deployments/[id]/submit/route.ts
│   │   ├── deployments/[id]/events/route.ts        ← SSE
│   │   ├── deployments/[id]/qr/route.ts
│   │   ├── deployments/[id]/sep7/route.ts
│   │   ├── cron/poll-events/route.ts
│   │   ├── cron/finalize-deployments/route.ts
│   │   └── health/route.ts
│   └── layout.tsx
├── components/
│   ├── builder/{Canvas,Palette,ConfigPanel,EnglishPreview}.tsx
│   ├── deploy/{DeployModal,LiveFeed,QrCard}.tsx
│   └── ui/                          ← shadcn components
├── lib/
│   ├── env.ts                       ← Zod-validated env
│   ├── auth.ts                      ← Auth.js config
│   ├── db.ts                        ← Prisma client (singleton)
│   ├── redis.ts
│   ├── rate-limit.ts
│   ├── audit.ts
│   ├── stellar/
│   │   ├── client.ts                ← RPC clients
│   │   ├── deploy.ts                ← prepare/submit
│   │   ├── events.ts                ← event poller + decoder
│   │   └── sep7.ts
│   ├── flows/
│   │   ├── schema.ts                ← Zod schemas
│   │   ├── validate.ts              ← DAG + invariants
│   │   ├── english.ts               ← English preview
│   │   └── to-params.ts             ← graph → contract init args
│   └── log.ts                       ← Pino
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── contracts/                       ← Rust workspace
│   ├── splitter/
│   ├── streamer/
│   ├── conditional/
│   └── Cargo.toml
├── scripts/
│   └── upload-wasm.ts
├── tests/
│   ├── unit/
│   └── e2e/
├── public/
├── docker-compose.yml
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── pnpm-lock.yaml
├── AGENT.md
└── SPEC.md
```

## Appendix B — Open Questions for Product

1. Is the seed flow allowed to grant the admin one pre-funded testnet account for the demo, or must the admin friendbot-fund themselves?
2. For mainnet (post-hackathon), do we want a fee-bumper service so users without XLM can still deploy?
3. Should the embed page (`/deployments/.../embed`) require a signed URL to avoid leaking contract activity?
