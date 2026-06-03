# Features

Running log of user-visible features.

## Additional decoupled contracts

Six new contract templates implementing the full architecture from issue #132.

### Triggers

- **`contracts/triggers/webhook`** — relayer-authorized trigger for off-chain events
  (e.g., Shopify order). An authorized relayer calls `execute(from, amount)` to pull
  funds and push them to `next_steps`.
- **`contracts/triggers/subscription`** — recurring billing puller. Stores a
  subscriber address and `amount_per_period`. Anyone (cron relayer) can call `charge()`
  to pull authorized funds via `transfer_from` and forward downstream.
- **`contracts/triggers/oracle`** — price-conditioned trigger. An off-chain relayer
  passes a price; if it meets or exceeds the stored threshold, funds are pulled from
  the caller and forwarded.

### Conditions

- **`contracts/conditions/multisig`** — true N-of-M human-in-the-loop gate.
  `receive_and_forward` locks incoming funds. Signers call `approve_by(signer)`.
  Once the approval count hits the threshold, anyone can call `release()` to forward
  the balance and reset approvals.

### Actions

- **`contracts/actions/swapper`** — fixed-rate token swapper. Receives `asset_in`,
  computes `asset_out = amount * rate_bps / 10_000` from the contract's topped-up
  balance, and forwards `asset_out` to `next_steps`.
- **`contracts/actions/yield`** — vault depositor. Receives funds and transfers them
  into a configured `vault` address (e.g., a lending pool), tracking `total_deposited`.
  Forwards execution control with amount=0 since funds have moved.

All new contracts follow the same `receive_and_forward` interface and error/event
patterns as the existing base contracts.

## Builder integration for new contract types

The builder palette, config panel, validation pipeline, and deploy layer now
support the six new decoupled contract types.

**New palette blocks:**

| Group    | Block                | Config fields                                |
| -------- | -------------------- | -------------------------------------------- |
| Triggers | Webhook              | asset, relayer address                       |
| Triggers | Subscription         | asset, subscriber address, amount per period |
| Triggers | Oracle               | asset, price threshold                       |
| Actions  | Swap                 | asset in, asset out, rate (basis points)     |
| Actions  | Yield                | asset, vault address                         |
| Logic    | Condition → multisig | signer list, threshold                       |

**Validation updates:**

- `validateFlow` accepts receive-like triggers (`on_receive`, `webhook`, `oracle`)
  and schedule-like triggers (`on_schedule`, `subscription`) with any action.
- New action types (`swap`, `yield`) are validated for reachability and DAG rules.
- Multisig conditions validate that `threshold <= signers.length`.
- `templateKind` inference maps new triggers to `SPLITTER` / `STREAMER` /
  `CONDITIONAL` as appropriate.

**Pipeline mapping:**

- `flowToPipeline` emits `WEBHOOK`, `SUBSCRIPTION`, `ORACLE`, `MULTISIG`,
  `SWAPPER`, and `YIELD` pipeline nodes with correct constructor params.
- `scval.ts` serializes constructor args for all new contract kinds.

**Prisma / env:**

- `TemplateKind` enum expanded with `WEBHOOK`, `SUBSCRIPTION`, `ORACLE`,
  `MULTISIG`, `SWAPPER`, `YIELD`.
- New per-network WASM hash env vars added (e.g.
  `STELLAR_WASM_HASH_WEBHOOK_TESTNET`).

## Builder node visual sync + deploy state preservation

Fixes for two builder UX issues where canvas nodes did not reflect edits and
unsaved changes could be lost when navigating to deploy.

- `updateNode` in `builder-client.tsx` now updates both `flowNodes` and
  `rfNodes` so React Flow canvas nodes re-render immediately when config values
  (e.g., asset symbol, amount, recipient count) change. Previously only
  `flowNodes` was updated, so the canvas stayed stale even though the config
  panel showed the new values.
- `saveGraph` now returns a `Promise<void>` and supports an `immediate` flag
  that bypasses the 800ms debounce.
- `DeployButton` accepts an `onClick` handler; the builder flushes the pending
  autosave immediately before navigating to `/flows/[flowId]/deploy`. This
  prevents the scenario where a user edits a flow, clicks Deploy before the
  debounce fires, and sees stale data on the deploy review page or after a
  failed deployment.

## Decoupled contracts base

First iteration of the new decoupled architecture where contracts chain together
via a standard `receive_and_forward` interface instead of relying on a single
orchestrator.

New crates:

- **`contracts/trigger`** — entry-point contract that receives an external call
  (`trigger(from, amount)`), pulls funds from the caller, and pushes them to its
  configured `next_steps` via `receive_and_forward`.
- **`contracts/timelock`** — conditional gate that accumulates funds in
  `receive_and_forward` and holds them until `unlock_time`. Admin calls
  `release()` to forward the stored balance to `next_steps`.
- **`contracts/router`** — threshold router that immediately routes incoming
  funds to `path_a` (amount ≥ threshold) or `path_b` (amount < threshold).
- **`contracts/splitter`** — updated with `receive_and_forward` and
  `set_next_steps` so it can participate in chains. It distributes funds to
  recipients by BPS and then passes execution control to `next_steps`.

Shared interface:

```rust
fn receive_and_forward(env: Env, from: Address, asset: Address, amount: i128, next_steps: Vec<WorkflowTarget>)
```

`WorkflowTarget` is a richer struct containing `address: Address` and
`data: String` for extensible payload usage.

All contracts use a **push-based** fund flow: the predecessor transfers funds to
the current contract before calling `receive_and_forward`; the current contract
does its logic and then transfers from itself to the next target before invoking
the next `receive_and_forward`.

## Mobile wallet support on trigger page

The trigger page (`/trigger/[deploymentId]`) supports mobile wallets through
WalletConnect. On mobile browsers, tapping "Connect Wallet & Trigger" opens the
WalletConnect modal directly (bypassing the Stellar Wallets Kit modal) so users
can pick Freighter, LOBSTR, or xBull and establish a session in one flow.

- On **mobile**, the flow bypasses the WalletConnect modal (which on Android
  ignores custom `mobileWallets` and relies on an explorer fetch that often
  fails). Instead, a native wallet picker overlay is shown with Freighter,
  LOBSTR, and xBull. Tapping a wallet constructs the correct WalletConnect deep
  link and opens the app directly. After the user approves the connection, the
  transaction is prepared and signed automatically.
- On **desktop**, the Stellar Wallets Kit modal is used, offering Freighter
  extension and WalletConnect.
- Existing WalletConnect sessions are reused when available, avoiding redundant
  connection prompts.
- `@walletconnect/sign-client` is an explicit dependency so the flow can create
  a `SignClient`, obtain the WalletConnect URI, and sign transactions.
- CSP `img-src` now allows `https://stellar.creit.tech` and
  `https://explorer-api.walletconnect.com` so wallet icons render in the
  Stellar Wallets Kit modal.

## Client-side 4xx error toasts

Several client-side fetch calls that previously swallowed or silently ignored
4xx responses now surface them as toast messages.

- Passkey manager load failure now shows a toast instead of silently rendering
  an empty list.
- Passkey login options/verify fetches now check `response.ok` before parsing
  so 4xx responses produce meaningful error toasts.
- Builder autosave now surfaces 4xx errors (e.g., validation or auth failures)
  with a toast instead of only logging 5xx errors.

## Whole-number-friendly amounts and shares

Amounts and recipient shares are now displayed with non-technical users in
mind.

- New `formatAmount()` helper caps displayed decimal places at 4 so tiny
  sub-XLM values don’t overwhelm the UI with 7-digit decimals.
- Live events and canvas node labels now use `formatAmount()` for cleaner
  reading.
- Trigger page placeholder changed from "e.g. 5.0" to "e.g. 5".
- Adding a new recipient in a Split node now defaults to 1% (was 0.01%).

## Event polling robustness fixes

Follow-ups to the live-events polling implementation (`lib/stellar/events.ts`).

- Cursor check tightened from `cursor?.lastLedger` to `cursor` so a cursor row
  with `lastLedger: 0` no longer falls through into the `deployTxHash` branch.
- The `-200` first-poll ledger buffer is now a named constant
  (`FIRST_POLL_LEDGER_BUFFER`) with a one-line rationale comment.
- Added a load-bearing comment explaining why `maxLedger = startLedger - 1`
  is the correct empty-set sentinel and how the caller’s guard prevents stale
  cursor writes.
- Added unit tests (`tests/unit/stellar/events.test.ts`) covering the
  cursor-exists, no-cursor + deployTxHash, no-cursor + no-deployTxHash, and
  getDeploymentLedger failure paths.

## Trigger flow follow-ups

Architectural improvements to the public trigger (QR → wallet → distribute)
flow.

- `DEPLOY_TRIGGER` audit is no longer written at prepare time (when the
  unsigned XDR is returned). Instead, `DEPLOY_TRIGGER_CONFIRMED` is written
  by the new `tx-status` endpoint only after the transaction succeeds on-chain.
  This eliminates false audit records for abandoned triggers.
- `submitTriggerTx` no longer blocks the HTTP response for up to 60 seconds
  while polling `getTransaction`. It returns `PENDING` immediately after
  `sendTransaction` succeeds.
- New `GET /api/deployments/[id]/tx-status?txHash=...` endpoint lets the
  client poll for finality. Rate-limited at 60 req/min per IP.
- `TriggerButton` now polls `tx-status` client-side with a 60-second timeout
  and abort-on-cancel support. Users see "Waiting for confirmation..." instead
  of a hung HTTP request.
- Clipboard copy in trigger and deployment pages now falls back to
  `document.execCommand("copy")` for iOS Safari \< 16.4 and insecure contexts.

## Mainnet transition: network pinned per environment

The deploy review page no longer asks the user to pick testnet vs mainnet,
type an `"I understand"` confirmation, or wait on an
`ENABLE_MAINNET` flag. Instead, the network is pinned at the environment
level via the `STELLAR_NETWORK` env var (staging = `testnet`, production =
`mainnet`).

- Deploy review shows a read-only **Network** chip ("TESTNET" or "MAINNET")
  next to the Deploy button — derived from `env().STELLAR_NETWORK`. There is
  no longer a radio picker, an `"I understand"` textbox, or a mainnet
  disable.
- The prepare endpoint (`POST /api/deployments/prepare`) no longer accepts a
  `network` body field; it always uses the env-pinned network when looking
  up the matching `ContractTemplate`.
- WASM hashes are stored under per-network env-var names
  (`STELLAR_WASM_HASH_<KIND>_<TESTNET|MAINNET>`); `scripts/upload-wasm.ts`
  takes a `--network=` flag and the seed script reads the row that matches
  the env.
- Operator runbook: `docs/mainnet-cutover.md`.

## Builder + landing/login follow-ups

Small follow-up polish on top of the builder rework and the pre-launch
landing/login trims.

- Builder top strip reorders Deploy and Ask AI so they cluster on the left
  (`Deploy → Ask AI → flow title`), making the title fill the remaining row
  width.
- Login page no longer renders the "Use the admin credentials seeded for
  your environment, or your own account." instructional paragraph above the
  form. The form itself is unchanged.
- Landing top nav removes the `Get started` register CTA; only the logo
  remains. The hero CTA still routes users to `/register`.

## Builder page polish

Reworked the visual hierarchy of `/flows/[id]` so the workflow name is the
page's primary anchor and the AI assistant is more obviously available.

- Global topbar no longer shows the fake `RPC 12MS` chip (account + sign-out
  controls are unchanged). A real RPC health probe is tracked separately.
- Builder top strip now reads, left-to-right: **Deploy** → editable **flow
  title** (24px Space Grotesk headline, borderless, autosaves) → primary pink
  **Ask AI** button (`auto_awesome` icon when collapsed, `close` icon + outline
  treatment when the panel is open). The button carries
  `aria-expanded` / `aria-controls="ai-panel"`.
- The center-top template badge is gone. Contract template (Splitter /
  Streamer / Conditional, or `—` when undetermined) now lives in a
  `/ CONTRACT TEMPLATE` section at the top of the Palette sidebar, with a
  one-line description.
- The English Preview is no longer a floating overlay at the bottom of the
  canvas — it renders as a glass-panel row directly under the title strip,
  reading as narration of the title rather than a canvas footer. Error lines
  use the error token; the preview text is selectable.
- AI panel header collapses to a single headline ("Ask AI to edit your flow")
  — the redundant "Raft Log" line was removed. The collapsed-edge pill on the
  right edge now reads "Ask AI" (was "AI") to match the in-canvas toggle.
- `TEMPLATE_LABELS` plus a new `TEMPLATE_DESCRIPTIONS` map live in
  `lib/flows/template-labels.ts` so the Palette and builder share copy.

## Stellar.expert explorer links

Contract addresses across the UI now link to the corresponding
[stellar.expert](https://stellar.expert) page for the deployment's network.

- Deployment detail header (`/deployments/[id]`): clicking the truncated
  contract address opens `stellar.expert/explorer/{testnet|public}/contract/{C…}`
  in a new tab.
- Deployment view (`components/deploy/deployment-view.tsx`): the full contract
  address is a link to stellar.expert; a separate copy button preserves the
  copy-to-clipboard affordance.
- Dashboard deployments row: an `open_in_new` icon next to each row opens
  stellar.expert directly without navigating into the deployment.

Network mapping is explicit: `testnet → testnet`, `mainnet → public`. If a
deployment row has an unknown network value or no contract address yet, the
link is omitted (the existing waiting state is unchanged) and a pino warning
is logged.

## Pre-launch landing & login prune

Trimmed marketing surface to a minimal, focused funnel:

- Landing nav: only logo + "Get started" CTA (removed "How it works",
  "Contracts", "Sign in").
- Hero eyebrow now reads `ZAP FOR PAYMENTS · POWERED BY STELLAR`.
- Removed the hero status line (`SYSTEM STATUS / AVG DEPLOY / RPC`) and
  the marquee `TelemetryTicker` section.
- Footer keeps only the copyright (About / Privacy / Terms links removed;
  underlying `app/about`, `app/privacy`, `app/terms` pages remain reachable).
- Contract template tiles: no more fake-address line, no "audited" wording.
- Login page: no "Forgot password?" or "Create one" links (routes still
  reachable directly).
- Login form: removed the "Sign in with passkey" affordance and the OR
  divider; `components/auth/passkey-login.tsx` stays in the tree for
  later re-wiring.
