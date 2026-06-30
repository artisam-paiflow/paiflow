# Dev Mode — Mutable / Parameterized Flows (design discussion)

> **Concept:** Shift from purely immutable flows (recipients + details fixed at
> flow-design time) to _parameterized_ flows where details can be left blank at
> design time and filled / changed later via API. This abstracts the
> design-time vs. runtime split of programming: authoring a flow == writing a
> function signature; calling the API == invoking it with arguments.
>
> Pinkraft becomes a **programmable web3 backend** for web2 developers. This
> surface is **API-only (no UI)**, gated behind a **dev mode**.

## Open design questions (answer one at a time)

- [x] **1. Where does mutability live — contract or backend?**
      → **DECIDED:** New, separate set of **dev-mode contracts** with on-chain
      mutable params. Only for nodes that need it — **onSchedule, pay, split**.
      All other nodes keep their existing immutable contracts untouched.
      (See "Decision: Q1" below for open sub-questions.)
- [x] **2. What's the dev-mode boundary?**
      → **DECIDED:** - **Dev mode is a per-flow flag** (`flow.devMode`), toggled by a **switch
      on the builder canvas**. - **Authoring stays in the UI.** Filling mutable values happens via **API,
      after deploy.** (No API-authoring of flows.) - **Variant selection is per-node and derived, not a manual marker:**
      `(flow.devMode && hasDevCounterpart(node)) ? use _DEV kind : normal kind`.
      Nodes without a dev counterpart are unaffected. - When dev mode is on, a node with a counterpart shows **only** the dev
      variant in palette/config. - **Mutable values are OPTIONAL at design time:** - pre-filled → seeded as the initial/default value, still changeable via
      API later; - blank → flow deploys "not yet configured", filled via API post-deploy. - Naming decision: **`_DEV` suffix** (`SPLITTER_DEV`, `PAYER_DEV`,
      `SUBSCRIPTION_DEV`).

### Contract implication from Q2 (net-new work beyond copying payroll)

The dev contracts CANNOT copy payroll verbatim — payroll panics on empty
recipients (`NoRecipients`). Dev variants must support a blank/deferred state:

1. Constructor accepts **empty/blank** params (deferred config).
2. A **"not yet configured" guard** so `charge`/`execute`/`distribute` fails
   _cleanly_ if triggered before blanks are filled (no garbage payout, no raw
   panic).
3. The setter (`update_recipients`, etc.) is the path from blank → configured.

- [x] **3. What's parameterizable per node?**
      → **DECIDED:** - **pay** → `recipient`, value (`amountStroops` / `percentage`), `asset`. - **split** → full `recipients[]` (address + bps/amount, carrying `mode`). - **subscription (onSchedule)** → `subscriber`, `amountPerPeriodStroops`,
      **and the schedule itself** (interval, end) — **schedule is mutable.** - Implication: the cron / `next_charge_at` logic must handle
      **reschedules** when interval/end are updated post-deploy.
- [x] **4. Auth & safety model.**
      → **DECIDED: relayer may mutate too**, not just execute. Setters accept
      **admin OR relayer** auth (`update_recipients`, schedule setters, etc.).
      This lets the API (holding the relayer key) fill/change values directly. - Mutation events already record the caller (`recipient_updated` publishes
      the acting address) → audit trail distinguishes admin vs relayer. - **Trust note:** the relayer key now controls payouts (recipients +
      amounts + schedule). Backend key management + API-key scoping +
      rate limits matter. `RECIPIENT_UPDATED` EventKind already exists for
      the audit log.

---

## Status: all four questions resolved — issue #235 created.

GitHub issue: https://github.com/webnxt-2030/pinkraft/issues/235

---

# Phase 2 — Decompose payroll + fiat off-ramp on dev variants

The dev-mode work above is the **preface** for a larger restructuring of the
payroll feature. Three moves:

1. **Split the payroll monolith into nodes.**
2. **Reframe fiat conversion (USDC/XLM → PHP via PDAX) as an off-ramp
   primitive**, not a swapper rewrite.
3. **Extend the dev variants of payer + splitter to deliver to banks**
   (PDAX fiat withdrawal). Dev variants only.

## 2.1 — Split payroll into nodes ✅ agreed

Payroll today is a monolith bundling three concerns. They map onto dev nodes:

> **payroll = `onSchedule_dev` (employer pulls each period) → `splitter_dev`
> (distribute to recipients)**

- The mutable recipients already shipped become the `splitter_dev` recipients.
- Payroll stops being bespoke and becomes a **preset composition** of dev nodes.
- **Protect atomicity:** the monolith pulls + distributes in ONE tx (cf. the
  `subscription-bugs-and-contract-atomicity` merge). The pipeline already does
  in-tx cross-contract forwarding — see swapper's
  `receive_and_forward(... step ...)`, which transfers to the next step's
  address within the same tx. Decomposed payroll must deploy as a chained
  pipeline so atomic pull→distribute is preserved.
  - [x] **DONE.** The factory chains `subscription_dev → splitter_dev` in one
        tx: `flowToPipeline` wires `nextStepNodeIds`
        (`lib/flows/to-params.ts`, covered by `tests/unit/to-params.test.ts`
        "decomposes a dev-mode payroll into SUBSCRIPTION_DEV → SPLITTER_DEV"),
        and `subscription_dev`'s `execute_charge` pulls from the employer then
        forwards to each next step via `receive_and_forward` in the same
        transaction.

## 2.2 — Fiat conversion is an OFF-RAMP, not a swapper rewrite ⚠️

The current swapper (`contracts/actions/swapper/src/lib.rs`) is **synchronous,
on-chain, atomic** — a fixed-rate `asset_in → asset_out` transfer from a
pre-funded balance, all in one tx.

PDAX conversion is the opposite on all three axes: **asynchronous, off-chain,
custodial, multi-step, failable** — `PENDING → RUNNING → QUOTED → INITIATED →
COMPLETED/FAILED` (`lib/offramp/jobs.ts`), cron-driven, quote→trade→withdraw.
**You cannot call PDAX inside a Soroban tx and get PHP back.**

Consequences:

- A "PDAX swapper" output (PHP in a bank) **leaves the chain** → it is a
  **terminal sink**, like the off-ramp already is. It cannot feed another
  on-chain node mid-pipeline.
- This is not a swapper reimplementation — it is the **off-ramp primitive**
  (`lib/offramp/*`, `OffRampPayoutJob`, `OffRampSenderProfile`) wearing a
  swapper label.

**→ Do NOT rewrite the swapper.** Keep it as the on-chain swap.

## 2.3 — Bank delivery on payer/splitter dev variants ✅ agreed

A `payer_dev` / `splitter_dev` recipient becomes a discriminated type:

- **Stellar address** → on-chain transfer (atomic, trustless), or
- **Bank account** → off-ramp: on-chain leg moves USDC to the off-ramp treasury
  - emits an intent event; backend cron runs the PDAX job → InstaPay withdrawal.

Reuses `OffRampPayoutJob` / `OffRampSenderProfile` / `EmployeeBankDetail`.

## Synthesis: 2.2 and 2.3 are the SAME primitive

"Convert USDC/XLM → PHP" and "pay a recipient via bank" are one capability —
**deliver value as fiat to a bank via PDAX** — used two ways. Standalone
conversion is just a payer_dev with a single bank recipient.

- [x] **DONE — `OffRampPayoutJob` decoupled from payroll.** It now carries a
      generic `(source, deploymentId, sourceAddress, amountStroops, bank*)`
      reference (`OffRampJobSource` defaults to `PAYROLL` for back-compat); the
      payroll-specific `employeeId` / `payrollPayoutId` / `payrollRunId`
      relations are now nullable, so payer/splitter cash-outs reuse the same job
      (`prisma/schema.prisma`).

## Costs of going fiat (why dev-variant-only is correct)

Fiat is inherently custodial / non-atomic, so it belongs ONLY in dev variants,
never in the trustless immutable contracts:

- **Atomicity ends at the chain boundary.** On-chain leg atomic up to
  "USDC in off-ramp treasury"; fiat delivery is eventually-consistent with
  retries + failure states. **Need a refund/retry policy** for when the on-chain
  leg succeeds but PDAX fails.
- **KYC.** Bank recipients require a verified `OffRampSenderProfile` on the
  deployer.
- **Hard PDAX constraints** (`pdax-uat-constraints`): UAT institutional wallet
  uses `USDC` (Stellar USDC / `USDCXLM` deposits are disabled), network
  `XLM_USDC_T_CEKS`, `InstaPay`, two banks (`BASECPH`, `BACTBPH`).

## Phase 2 decision (resolved): dedicated terminal "cash-out" node — option (b)

Fiat conversion is exposed as a **distinct terminal node** ("cash-out"), not a
recipient type. Recipients on payer/splitter stay address-only; leaving the
chain is its own explicit step.

```
[onSchedule_dev] → [splitter_dev] → [cash-out → bank BASECPH]
```

### Implications of (b)

- **Brand-new node type** (e.g. `cashout` / `offramp`), terminal-only.
- **Dev-mode-only node with NO immutable counterpart.** This is a new category:
  the per-node resolver so far was `devMode && hasDevCounterpart`. Cash-out has
  no non-dev version, so palette logic needs a third bucket —
  **dev-only nodes** (shown only when `flow.devMode`, hidden otherwise).
- **Terminal / leaf.** Validation must enforce it has no outgoing edge (cannot
  feed another node — its output leaves the chain).
- **On-chain leg:** receives USDC → moves to the off-ramp treasury → emits an
  intent event. A thin `CASHOUT_DEV` contract (or reuse of the
  `receive_and_forward` treasury pattern). Backend cron picks up the event and
  runs the PDAX job (quote→trade→InstaPay withdrawal).
- **Bank details are mutable** (consistent with dev mode): blank at design time,
  filled via API post-deploy; or pre-filled as defaults.
- Still requires **decoupling `OffRampPayoutJob` from payroll** (generic
  deployment/recipient/amount reference).
- Inherits all fiat costs: refund/retry policy on PDAX failure, KYC
  (`OffRampSenderProfile`), PDAX constraints (UAT wallet uses `USDC`;
  `USDCXLM` deposits disabled, `InstaPay`, `BASECPH`/`BACTBPH`).

### Open sub-questions for the cash-out node

- [x] **Node/contract name: `cash_out`.**
- [x] **Contract: thin dedicated `CASH_OUT_DEV` — reuse the PATTERN, not the
      swapper.** The swapper carries three behaviors cash-out must NOT have:
      rate conversion (`amount * rate_bps / 10_000`), pre-funded `asset_out`
      liquidity (`top_up` + balance check), and forwarding to `next_steps`.
      Reusing it as-is = footgun (fake rate, fake liquidity, empty steps).
      Instead build a stripped-down sink modeled on `receive_and_forward`: > receive USDC → transfer to the off-ramp **treasury** (relayer-controlled) > → emit `cash_out` event `(amount, bankRef)`.
      No rate, no liquidity, no forwarding. Backend cron runs the PDAX leg.
- [x] **Refund: auto-refund ONLY before the PDAX trade executes.**
      PDAX leg = quote → trade(sell) → withdraw (`lib/offramp/pdax.ts`;
      states `QUOTED → INITIATED → COMPLETED/FAILED`). The trade is the point of
      no return. - Pre-trade FAILED (quote rejected / validation / network): USDC still in
      treasury → auto-refund = treasury transfers back to source. Simple, and
      covers most failures. - Post-trade FAILED (USDC already sold for PHP): nothing to refund as
      crypto → **retry the withdrawal**, do NOT refund. - Requirement: the cash-out job must record the **source address** for the
      refund path.

---

## Decision: Q1 — separate dev-mode contracts (on-chain mutable)

**Approach:** Build a parallel set of contracts for dev mode rather than
modifying existing ones. Scope limited to the three nodes that benefit:

| Node       | Existing contract       | Dev-mode variant needed        |
| ---------- | ----------------------- | ------------------------------ |
| onSchedule | (trigger — TBD mapping) | yes — mutable schedule         |
| pay        | `actions/payer`         | yes — mutable recipient/amount |
| split      | `actions/splitter`      | yes — mutable recipients/rates |
| all others | unchanged               | no — keep immutable            |

**Sub-questions for Q1 — findings:**

- [x] **`onSchedule` maps to `subscription`.** Confirmed: `SubscriptionTrigger`
      (`lib/flows/schema.ts:111`) is the recurring/scheduled trigger
      (asset, subscriber, amountPerPeriod, interval, ends/occurrences). The
      dev-mode schedule contract = `contracts/triggers/subscription`.

- [x] **Mutability pattern — copy the payroll contract** (`contracts/actions/payroll/src/lib.rs`,
      commit `476cc78`). It is already a complete dev-mode prototype: 1. All params seeded in `__constructor`, kept in instance storage. 2. Admin-auth'd on-chain setters that mutate + emit events:
      `update_recipients()` → emits `recipient_updated`; `set_relayer()`. 3. **Dual-auth execution:** `charge()` (admin auth) vs
      `charge_by_relayer()` (relayer auth) — a backend relayer key triggers
      execution without the user signing each time. This is the core of the
      "API-driven web3 backend". 4. `validate_recipients()` runs on every mutation — invariants enforced
      on-chain, not trusted from the API. 5. Getters for all state so the backend can read current config. - Note: payroll recipients are fixed `i128` amounts. Splitter also
      supports **bps/percentage** mode, so the split dev setter must carry the
      mode, not just amounts.

- [x] **Registration — RECOMMENDED: new `TemplateKind`s, not a flag.**
      Each dev variant is a separate WASM with its own hash, and the whole
      pipeline (`upload-wasm.ts`, `update-hashes.ts`, factory registration,
      `ContractTemplate(kind, network)` unique key) assumes a 1:1 kind→hash
      mapping. A boolean flag would force one kind to resolve to two hashes. - Add `SPLITTER_DEV`, `PAYER_DEV`, `SUBSCRIPTION_DEV` (or `_MUTABLE`). - Flow node `type` stays `"split"` / `"pay"` / `"subscription"` — UI,
      schema, validation shared. - A node/flow-level `mutable: true` marker selects the variant. - Deploy resolver: `mutable ? SPLITTER_DEV : SPLITTER`. - [x] **RESOLVED:** naming = `_DEV`. Marker is derived per-node from the
      per-flow `devMode` flag (see Q2), not a manual per-node field. - [x] **DONE.** Setter auth confirmed identical across all dev variants:
      `subscription_dev`, `splitter_dev`, `payer_dev` and `cash_out_dev` gate
      mutations behind `require_admin_or_relayer` (admin OR relayer), while
      execution stays dual-auth (`charge` admin vs `charge_by_relayer`). The
      relayer key can both fill values and trigger execution.
