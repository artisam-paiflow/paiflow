# Paiflow — Specification

> **"Zaps for money"** — a visual builder where users connect triggers ("when this happens") to
> actions ("pay this") and deploy a live Soroban contract on the Stellar network in under a minute.

## What this document is

This is the **product** spec: the authority on what Paiflow is for and what its primitives mean.
[`CLAUDE.md`](./CLAUDE.md) is the authority on _how_ to build here.

It deliberately does **not** restate the implementation. Earlier revisions carried a domain model, a
page table, an endpoint table and a file tree. All four drifted within a release or two — the domain
model ended up documenting a database model that never existed, and the endpoint table listed 29 of
83 routes. A prose inventory of code cannot be kept true, so those sections are gone rather than
merely corrected. Read the artefact that is generated from the system instead:

| You want                                    | Read                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Data model                                  | [`prisma/schema.prisma`](./prisma/schema.prisma)                       |
| Pages and API endpoints                     | `app/` and `app/api/`                                                  |
| Stack, project layout, env vars, deployment | [`README.md`](./README.md)                                             |
| Architecture, conventions, security rules   | [`CLAUDE.md`](./CLAUDE.md)                                             |
| Architecture diagrams                       | [`docs/architecture-diagrams.md`](./docs/architecture-diagrams.md)     |
| Contract surface and build pipeline         | [`docs/soroban-smart-contracts.md`](./docs/soroban-smart-contracts.md) |
| Mainnet go-live                             | [`docs/mainnet-cutover.md`](./docs/mainnet-cutover.md)                 |

The block library ([§3](#3-block-library)) is the one part of the system whose _intent_ is not
recoverable by reading the code. It is the reason this file still exists.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Tech Stack & Dependencies](#2-tech-stack--dependencies)
3. [Block Library](#3-block-library)
4. [Authentication & Authorization](#4-authentication--authorization)
5. [Security Posture](#5-security-posture)
6. [Demo Script](#6-demo-script)
7. [Out of Scope](#7-out-of-scope)
8. [Appendix — Open Questions for Product](#appendix--open-questions-for-product)

---

## 1. Product Overview

### 1.1 Problem

Every fintech and SMB that wants **programmable payments** must hire a Rust developer or pick from
off-the-shelf SaaS. There is no middle layer.

### 1.2 Solution

Paiflow is the missing middle layer:

- Drag a trigger (`On Receive`, `On Schedule`, …) onto a canvas.
- Drop actions (`Pay`, `Split`, `Cash Out`, …) and optional logic (`Condition`).
- Click **Deploy** — reviewed, unit-tested Soroban contracts are instantiated on Stellar with the user's
  parameters, wired together as one pipeline in a single transaction.
- Show a QR code; anyone can send funds to it.
- A live event feed animates the contract's execution in real time.

### 1.3 Hero Demo Beat

> Presenter drags **`On Receive USDC` → `Split 60/30/10` → `[Alice, Bob, Charlie]`** on a phone.
> Hits **Deploy**. QR code appears. Audience member scans, sends 10 testnet USDC. Within 5 seconds,
> three transactions fan out on the explorer projected on screen.

### 1.4 Non-Goals

- Multi-tenant org / team management beyond admin + user accounts.
- A general-purpose Soroban IDE. Users compose the shipped templates; they do not author Rust.
- A per-deploy network picker. The Stellar network is pinned per environment — see
  [`CLAUDE.md` §7.5](./CLAUDE.md#75-networks). Which network a deployment lands on is an
  environment property, not a user choice.
- A mobile native app. The web app must be fully responsive for mobile demo.

---

## 2. Tech Stack & Dependencies

**See [`README.md` → "Stack at a glance"](README.md#stack-at-a-glance).** That table is the single
source of truth for languages, frameworks, and version lines; it is not duplicated here or in
`CLAUDE.md`.

Exact versions are pinned by `package.json` + `pnpm-lock.yaml` for the Node app, and by
`contracts/Cargo.toml` + `contracts/Cargo.lock` for the Rust workspace. Where this document and a
lockfile disagree, the lockfile is right.

The build/upload toolchain for the Soroban workspace (Rust target, `soroban-sdk`, artifact layout)
is documented in [`docs/soroban-smart-contracts.md`](docs/soroban-smart-contracts.md) §4.2–4.3.

---

## 3. Block Library

A flow is a directed acyclic graph of **blocks**. Every block has a strict Zod schema validated on
save and again server-side at deploy time. This section says what each block is _for_ and which
invariants exist because money is at stake — the parts a reader cannot infer from a type.

Three files hold the truth about a block, and they answer different questions:

| Question                  | Authority                                                     |
| ------------------------- | ------------------------------------------------------------- |
| What fields does it take? | `lib/flows/schema.ts` (`FlowNodeSchema` is the complete list) |
| Can a user place it?      | `components/builder/palette.tsx` (the `hidden` flag)          |
| What does it do on-chain? | its crate under `contracts/`                                  |

**Availability** below is read from the palette. Five blocks are defined, deployable, and reachable
from an older saved flow, but are not in the palette today — they are documented rather than
dropped, and marked ◦ instead of ●.

`lib/flows/validate.ts` enforces the invariants. `lib/flows/to-params.ts` (`flowToPipeline()`)
turns a valid graph into the array of contracts the factory deploys.

### 3.1 Triggers

A trigger is the root of the graph and decides **when** money moves. Exactly one per flow.

|     | Block          | Fires when                                                          | Why it exists                                                                                     |
| --- | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| ●   | `on_receive`   | The contract receives the configured asset (optional minimum)       | The default. Turns an address into a programmable inbox — the QR-code demo path.                  |
| ●   | `on_schedule`  | A recurring interval elapses (minute … month, optional end / count) | Push payments the payer does not want to initiate by hand. Optionally pausable and reclaimable.   |
| ●   | `subscription` | A period elapses **and** the subscriber has authorized an allowance | Pull payments. The subscriber consents once; the relayer charges per period without them signing. |
| ●   | `payroll`      | A payroll period elapses, charged against the employer's allowance  | Subscription semantics with a recipient roster that changes between runs.                         |
| ●   | `web2_webhook` | An authenticated HTTP call arrives at the deployment's trigger URL  | For callers with no Stellar key at all. Labelled **"HTTP Webhook"** in the builder.               |
| ◦   | `webhook`      | A named relayer address invokes the contract                        | The Stellar-native variant of the above. Superseded by `web2_webhook`; hidden.                    |
| ◦   | `oracle`       | A relayer reports a value that crosses the configured threshold     | Payment conditional on external state. The value is relayer-reported, not read from a feed.       |

### 3.2 Actions

An action decides **where** money goes. A flow must contain at least one.

|     | Block          | Does                                                  | Notes that matter                                                                                                                                              |
| --- | -------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ●   | `pay`          | Sends to one recipient                                | Fixed amount, a percentage of what arrived, or the full amount. Supports a fiat payout mode.                                                                   |
| ●   | `split`        | Fans out to up to 20 recipients                       | Percentage mode (basis points) or fixed mode — never mixed. See the invariants below.                                                                          |
| ●   | `email_notify` | Emails recipients when the flow pays out              | Terminal only — it must have no outgoing edges, because it moves no money and nothing can be downstream of a notification.                                     |
| ◦   | `cash_out`     | Sends to the off-ramp treasury against bank details   | The bridge out of crypto: the contract holds the destination bank account, so the payout is as immutable as the on-chain leg. Not placed directly — see below. |
| ◦   | `swap`         | Pays `assetOut` at a rate fixed when the flow deploys | **Does not exchange anything yet.** See below.                                                                                                                 |
| ◦   | `yield`        | Transfers the balance to a vault address              | A plain token transfer; it does not call a vault protocol's deposit function and nothing accrues. Downstream steps are then invoked with `amount=0`.           |

**`cash_out` is not dragged onto the canvas.** Setting a `pay` or `split` recipient to fiat payout
generates a cash-out contract for that recipient at deploy time. The block exists so the pipeline
has something to deploy; the palette entry is hidden because `pay` and `split` already reach it.

**`swap` does not swap.** `contracts/actions/swapper/src/lib.rs` computes
`amount_out = amount * rate_bps / 10_000` from a rate stored at deploy, then pays `assetOut` out of
the contract's own pre-funded balance, panicking with `InsufficientOutput` if that balance is short.
Its own comment: _"In a real DEX integration this would call the AMM. Here we simulate."_ There is
no market rate and no counterparty. Wiring it to a real router is Deliverable 1 of the approved
SOW, [`docs/instawards-phase-1-sow.md`](./docs/instawards-phase-1-sow.md); until that lands, treat
this block as a fixed-rate payout from a pre-funded balance, not an exchange.

### 3.3 Logic

`condition` (●) gates everything downstream of it. Its `kind` selects the test: `amount_gt`,
`amount_lt`, `oracle_gte`, `time_after`, `time_before`, or `multisig` (N-of-M signer approval).
`multisig` is a condition kind, not a block of its own.

### 3.4 Invariants

Graph shape:

- Exactly one trigger node, and it is the root.
- At least one action node.
- No cycles. Edges run trigger → (condition?) → action.

Money:

- **Split recipients must all use the same mode.** In percentage mode the basis points must sum to
  exactly `10_000`; in fixed mode every amount must be positive and the total greater than zero.
  Mixing the two would make the payout depend on arrival order.
- No duplicate recipient addresses in a split — a duplicate is far more likely a mistake than an
  intent to pay someone twice.
- A scheduled split requires a positive amount per interval.
- Amounts are stroops as decimal strings end to end. See [`CLAUDE.md` §3.3](./CLAUDE.md#33-typescript).

Fiat payouts:

- A contract address (`C…`) as a recipient always means fiat — it is a cash-out contract.
- A fiat recipient needs account name, account number, and bank code.
- Sender KYC must be on file before a flow with any fiat payout can deploy.
- Fiat payouts are incompatible with `oracle_gte` conditions: the off-ramp leg cannot be unwound if
  the oracle moves after the payout is initiated.

Deferred configuration:

- Addresses may be left **pending** at design time and resolved before deploy.
- "Fill via API after deploy" (an empty split roster, `fillValueViaApi`, `fillScheduleViaApi`) is
  only legal in dev mode, where the deployed contract is mutable. Background:
  [`docs/design/2026-06-24-dev-mode-mutable-flows.md`](./docs/design/2026-06-24-dev-mode-mutable-flows.md).

### 3.5 English Preview Pane

`flowToEnglish(graph)` (`lib/flows/english.ts`) is a pure function rendering the canvas as prose, so
a non-technical operator can check the flow without reading the graph:

> "When this contract receives **USDC**, split **60%** to `GABC…XYZ`, **30%** to `GDEF…UVW`, **10%**
> to `GHIJ…RST`."

This is a product requirement, not a nicety: it is the last human-readable checkpoint before a user
signs a transaction that moves real money.

### 3.6 Beyond the block library

The block library is what a user assembles. This is the rest of the product surface — the parts that
have no palette entry. Each is one line plus where the truth lives; nothing here restates an
implementation.

| Surface                    | What it is                                                                                                                                                                      | Where it lives                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Relayer automation**     | Why `on_schedule`, `subscription`, `payroll` and timelock conditions fire at all. Paiflow's own key signs `*_by_relayer` calls on a cron so the user doesn't sign every period. | `app/api/cron/*`, `lib/stellar/relayer.ts`; [`CLAUDE.md` §2](./CLAUDE.md#2-architecture)                 |
| **Payroll**                | A recipient roster that changes between runs: employees, bank details, per-run payout records, and a catch-up limit so a lapsed schedule can't fire a year of charges at once.  | `Employee`, `PayrollRun`, `PayrollPayout`; `cron/auto-charge-payroll`                                    |
| **Fiat off-ramp**          | Payouts marked fiat become jobs walking `PENDING → RUNNING → QUOTED → INITIATED → COMPLETED \| FAILED \| CANCELLED`. A **mock provider is the default**; PDAX is opt-in.        | [`docs/pdax-institution-api.md`](./docs/pdax-institution-api.md)                                         |
| **Dev mode**               | A per-flow flag swapping in `_DEV` contract variants so values left blank at design time can be filled after deploy, authenticated by a token rather than a session.            | [`docs/design/2026-06-24-dev-mode-mutable-flows.md`](./docs/design/2026-06-24-dev-mode-mutable-flows.md) |
| **QR-triggered execution** | Every deployment renders a public SEP-7 URL. Anyone with a wallet can scan, sign, and fire it — no account on Paiflow required.                                                 | `/trigger/[deploymentId]`                                                                                |
| **Live event feed**        | On-chain events are ingested, never trusted from the client: cron poll → `ContractEvent` → Redis → SSE to the open page.                                                        | [`CLAUDE.md` §2](./CLAUDE.md#2-architecture)                                                             |
| **Raft Log**               | Edit a flow by voice or text. Speech → transcript → a JSON patch that must pass the same validator as a hand-drawn edit before it touches the graph.                            | `/api/transcribe`, `/api/flows/[id]/edit`                                                                |
| **Address book**           | Saved labels for Stellar addresses, reused by the builder and given to the AI so "pay Alice" resolves.                                                                          | `AddressBookEntry`, `lib/address-book.ts`                                                                |
| **Admin console**          | Users, audit log, and off-ramp provider credentials — the last so PDAX's ~10-minute tokens can be rotated without a redeploy.                                                   | `/admin/*`                                                                                               |
| **Deploys via a factory**  | One transaction deploys a whole pipeline, with child addresses pre-computed from deterministic salts.                                                                           | [`docs/soroban-smart-contracts.md`](./docs/soroban-smart-contracts.md) §4                                |

Two things deliberately absent: there is **no** per-deploy network picker (the network is pinned per
environment — [`CLAUDE.md` §7.5](./CLAUDE.md#75-networks)), and **no** in-app changelog. Feature
history is the git log; `docs/archive/features-through-2026-06.md` holds an earlier hand-kept log
that stopped.

---

## 4. Authentication & Authorization

### 4.1 Primary: username + password

- Auth.js v5 Credentials provider.
- Argon2id hashing (`memoryCost: 19456 KiB, timeCost: 2, parallelism: 1`).
- Lockout: 5 failed attempts → 15-minute lock (`User.lockedUntil`). Counter resets on success.
- Passwords: minimum 12 characters; rejected if the username appears as a substring; checked against
  the [HIBP k-anonymity API](https://haveibeenpwned.com/API/v3#PwnedPasswords) when
  `HIBP_CHECK_ENABLED` is set (fail-open on upstream error).
- Session: JWT in an `__Host-paiflow.session` cookie. `HttpOnly`, `Secure`, `SameSite=Lax`, 7-day
  lifetime.

### 4.2 Passkeys

- WebAuthn via `@simplewebauthn/*`, `rpId = AUTH_RP_ID`.
- Stored per-user in `Passkey`. The signature counter is incremented on assertion to detect clones.
- A user with passkeys still has a password; the passkey is an addition, never the only factor on
  file.

### 4.3 Authorization

- Two roles: `ADMIN`, `USER`.
- `requireSession(role?)` at the top of every owner- or admin-scoped Route Handler. Cron, webhook,
  and machine-token routes carry their own documented guards instead.
- Every flow/deployment endpoint verifies `resource.ownerId === session.user.id` unless the caller
  is an admin.
- Admin actions emit an `AuditLog` entry.

### 4.4 CSRF

Auth.js provides double-submit CSRF protection for **its own** `/api/auth/*` endpoints. The app's
other Route Handlers do not carry a CSRF token; they rely on the session cookie's `SameSite=Lax` and
`__Host-` prefix. Adding an origin check for state-changing handlers is tracked separately — do not
read this section as a claim that blanket CSRF coverage exists today.

### 4.5 Seeded Admin

Username `admin`, password from `ADMIN_SEED_PASSWORD` (required, no default; the seed exits non-zero
if it is missing or shorter than 12 characters).

---

## 5. Security Posture

The enforceable rules — the per-PR checklist, forbidden patterns, and an explicit register of rules
that tooling does **not** yet enforce — live in [`CLAUDE.md`](./CLAUDE.md) §10, §18 and §19. This
section states only the intent behind them, and the standing tension the product has to hold:

**Paiflow signs transactions that move real money, and is non-custodial.** Those two facts set the
posture. The backend may build and submit transactions; it never holds a user's private key. The one
server-held key is Paiflow's own relayer, which exists so scheduled charges can run without the user
signing each period, and the contracts enforce dual authorization (admin **or** relayer) so that key
cannot do anything an admin could not.

Consequences worth stating as product requirements rather than implementation detail:

- **Validate three times.** Client, server, and again inside the contract. A mis-parameterized
  splitter sends real money to the wrong address, and the on-chain leg cannot be recalled.
- **Every transaction-submitting surface shows which network it is on.** A user must never be
  unsure whether they are about to spend testnet or mainnet funds.
- **Amounts are integers, always.** Stroops as strings at every boundary; a float loses precision at
  exactly the resolution a stroop encodes.
- **Deployed contracts are immutable by default.** Dev mode's mutable variants are a separate,
  explicitly-chosen contract family, not a flag on the normal ones.
- **Generic auth errors, specific audit logs.** The user learns nothing from a failed login; the
  audit log records everything about it.

Headers, CSP, rate limiting, and redaction are implemented in `next.config.ts`, `lib/csp.ts`,
`lib/rate-limit.ts`, and `lib/log.ts` respectively. Read those rather than a copy of them.

---

## 6. Demo Script

1. Presenter opens Paiflow on a phone.
2. Logs in with a passkey (Face ID).
3. Drags `On Receive USDC` → `Split`.
4. Adds three recipients: `Alice 60%`, `Bob 30%`, `Charlie 10%`.
5. The English preview reads: _"When this contract receives USDC, split 60% to GABC…, 30% to GDEF…,
   10% to GHIJ…."_
6. Hits **Deploy** → wallet pop-up → signs.
7. QR code + contract address appears.
8. Audience member scans the QR with their wallet, sends 10 testnet USDC.
9. On the projector: the trigger node flashes; arrows fan out; three payout rows appear in the live
   feed; explorer links are shown.
10. Total time from "drag" to "done": **~90 seconds**.

---

## 7. Out of Scope

- Custom user-authored Soroban contracts.
- Team / org features beyond admin and user.
- A marketplace of community-shared flows.
- A mobile native app.
- Mainnet by default. Testnet is the default everywhere except the production environment.

---

## Appendix — Open Questions for Product

1. Should the seed flow grant the admin a pre-funded testnet account for demos, or must the admin
   friendbot-fund themselves?
2. Do we want a fee-bumper service so users without XLM can still deploy?
3. Should the embed page (`/deployments/[deploymentId]/embed`) require a signed URL to avoid leaking
   contract activity?
