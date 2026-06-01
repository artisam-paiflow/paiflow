# Features

Running log of user-visible features.

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
