# Instawards Phase 1 — build sheet

Internal execution sheet for the SDF Instaward (Philippines chapter, Chapter Lead Nelson Lumbres).
The reviewer-facing Statement of Work is the contract; this page is how the team works against it.

|               |                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| Sprint        | **Tue 8-Sep-2026 → Wed 7-Oct-2026** (day 30)                                                                 |
| Weeks         | W1 `8–14 Sep` · W2 `15–21 Sep` · W3 `22–28 Sep` · W4 `29 Sep – 7 Oct`                                        |
| Budget        | $5,000 — 123 h development + 37 h QA at $31.25/h                                                             |
| Network       | **Testnet only.** `STELLAR_NETWORK=testnet` everywhere — see [§7.5 of `CLAUDE.md`](../CLAUDE.md#75-networks) |
| Base branch   | `develop`                                                                                                    |
| Overview      | [`instawards-phase-1-overview.md`](./instawards-phase-1-overview.md) — the high-level one-pager              |
| SOW reference | [issue #173](https://github.com/webnxt-2030/pinkraft/issues/173)                                             |

**Hard out-of-scope**, from SOW §4.1 — do not let these creep in: mainnet, third-party audit,
new contract templates beyond the swapper, oracle triggers, fiat off-ramp (PDAX stays mocked),
x402/MPP, multi-chain, localisation, AI/voice features, and builder-wide UI refactoring.

---

## At a glance

| #   | Deliverable                                           | Owner | Week | Done when                                                                          |
| --- | ----------------------------------------------------- | ----- | ---- | ---------------------------------------------------------------------------------- |
| D1  | Swapper executes a real Soroswap swap end-to-end      |       | W1   | A swap tx hash on stellar.expert, produced from a flow built in the visual builder |
| D2  | Developer API exposes the swapper to external callers |       | W2   | `curl` with a deployment-scoped token executes a swapper flow on testnet           |
| D3  | Reusable builder inputs, adopted in the Swapper panel |       | W3   | Swapper panel renders shared primitives; component tests green in CI               |
| —   | Evidence package + demo video                         |       | W4   | Handoff pack accepted by the Chapter Lead                                          |

---

## D1 — Swapper, real DEX end-to-end

Week 1. The crate exists but fulfils swaps from a pre-funded balance —
`contracts/actions/swapper/src/lib.rs` says so in a comment: _"In a real DEX integration this would
call the AMM. Here we simulate."_ Note the swap node has **never deployed successfully** (see the
arity task below), so there is no live on-chain swapper and no production data to protect.

**Verify on day 1 — any of these can invalidate the week**

- [ ] The Soroswap **testnet router address**. It appears nowhere in this repo or `.env.example`.
- [ ] A Soroswap testnet **pool exists** for the pair we intend to demo. Our only known asset is
      Circle testnet USDC (`lib/stellar/assets.ts`), and `AssetSchema` hardcodes `z.enum(["USDC"])`.
      If there is no XLM↔USDC pool, we either seed liquidity ourselves or add Soroswap's test tokens.
- [ ] A throwaway contract can authorize the router's token pull (see the first task). Prove this
      against the real router before building anything else on top of it.

**Tasks** — ordered by risk, not by file

- [ ] **Authorize the router's pull.** `swap_exact_tokens_for_tokens` makes the router pull
      `asset_in` from the caller. With a contract as caller that needs
      `env.authorize_as_current_contract(...)` with an `InvokerContractAuthEntry`. **No crate in this
      workspace does this today** — every `approve` in contract code is a revocation (`amount = 0`),
      and the only outbound call to a non-owned contract, `conditional::query_oracle`, is read-only.
      This is the one part unit tests cannot validate: branch 157's tests pass only because
      `env.mock_all_auths_allowing_non_root_auth()` mocks away exactly this.
- [ ] **Add `parent` to the swapper and gate on it.** `swapper` and `yield` are the only two
      pipeline contracts without a `parent: Address`, and consequently the only two whose
      `receive_and_forward` has no `parent.require_auth()` — anyone can call it today. Add the field
      and the check, matching `cash_out::execute_step`. **This, not deletion, is the fix for the
      `scval.ts` mismatch below** — the SOW has it backwards.
- [ ] `lib/stellar/scval.ts` — the `swapper` case emits **6** ctor args; the Rust constructor takes
      **5**, so swap flows fail at simulation. Once `parent` is added to Rust, the count aligns; then
      swap `rateBps` for `slippageBps` + `routerAddress`. `yield` (next case down) has the same bug —
      fix both. Neither is covered by `tests/unit/scval.test.ts`, which is why this survived.
- [ ] `contracts/actions/swapper/src/lib.rs` — call the router; add `RouterAddress` + `SlippageBps`
      storage keys; **quote first** via `router_get_amounts_out`, then
      `amount_out_min = expected * (10000 - slippage_bps) / 10000`; pass a deadline
      (`ledger().timestamp() + 300`); drop `top_up()` prefunding.
- [ ] Same file — fix the forward loop, which sends the **full** `amount_out` to _each_ next step
      while the balance check above only verified one share. Fan-out > 1 drains the float.
- [ ] Same file — add `execute_step(asset, amount)` for consistency with `payer`/`splitter`/`cash_out`.
      Not a blocker: those contracts also expose `receive_and_forward`, which is what the swapper calls.
- [ ] `lib/flows/schema.ts` — `SwapAction` has `assetIn`, `assetOut`, **`rateBps`**. Replace with
      `slippageBps` + `routerAddress`. **Do not name the field `router`** — see Decision 6.
- [ ] `lib/flows/schema.ts` `migrateFlowGraph` — add a `swap` branch. It already back-fills
      `split`/`subscription`/`payroll`/`pay` and runs before parsing, so this avoids a DB migration
      entirely. Skipping it is worse than it sounds — see Decision 3.
- [ ] `lib/flows/to-params.ts` — `SwapperNodeParams` carries `rateBps`; swap it for the new fields.
- [ ] `lib/flows/validate.ts` — swap/yield are labelled `TemplateKind.SPLITTER`. Assign `SWAPPER` /
      `YIELD`. Per-node `flowToPipeline` is already correct; this is the flow-level label only, and
      it is why the `SWAPPER` branch in `lib/stellar/balances.ts` is unreachable. Cosmetic, not a
      deploy blocker. While there: `getSwapperAssetOut` picks the _first_ swap in the graph rather
      than the node being priced — wrong for any multi-swap flow.
- [ ] `components/builder/palette.tsx` — remove `hidden: true`, update the default config. **Also
      `lib/ai/prompts.ts`, 8 separate sites**, including the JSON template the model emits with
      `rateBps` baked in. Miss these and the assistant produces configs that fail Zod.
- [ ] `components/builder/config-panel.tsx` — the `node.type === "swap"` block already renders
      Asset In / Asset Out / Rate-bps. Replace the rate field with slippage + a router picker. Make
      the router an **allowlist select**, not a free-text address (Decision 5) — and note
      `address-input.tsx` cannot be reused for it regardless: it validates with
      `StrKey.isValidEd25519PublicKey`, so it rejects the `C…` contract address a router is. Also
      `components/nodes/action-node.tsx`, which renders `@ N%` on the node body.
- [ ] `lib/stellar/events.ts` `SWAPPER_REGISTRY` — `top_up` disappears, so its decoder is deleted and
      the `swap` decoder is rewritten. `lib/stellar/soroban-errors.ts` — `BadRate` becomes a
      slippage/router error. `lib/flows/template-labels.ts` still says "Fixed-rate token swap".
- [ ] `lib/flows/english.ts` — renders `"at N% rate"` from `rateBps`. Slippage is a tolerance, not a
      rate, so this needs rewording, not a field swap.
- [ ] `scripts/seed-all-events.ts` — the graph fixture hardcodes `rateBps: 9900`, and `SWAPPER`
      shares a branch with `ROUTER` (a threshold condition, not a DEX router). Split them.
- [ ] Tests — **14 fixtures** hardcode `rateBps: 9500`: 11 in `tests/unit/validate.test.ts`, 2 in
      `to-params.test.ts`, 1 in `english.test.ts` (which asserts the literal string
      `"swap XLM to USDC at 95% rate"`). Watch for false greens: several `expect(r.ok).toBe(false)`
      cases would keep passing for the wrong reason — a Zod failure instead of the asset mismatch
      they were written to catch.
- [ ] `SPEC.md` §3.2 — the "**`swap` does not swap**" paragraph and the `amount * rate_bps / 10_000`
      formula both describe the pre-D1 behaviour and must change when a real router lands.
- [ ] Build + upload wasm, then `pnpm contracts:update-hashes`. Upload auto-discovers the artifact;
      no swapper hash is committed today, so the `ContractTemplate` row does not exist until this
      runs. A running dev server caches hashes process-globally and needs a restart afterwards.
- [ ] Deploy and trigger one swapper flow on testnet.

**The factory does not change.** `contracts/factory/src/lib.rs` is 37 lines and fully generic — it
takes `constructor_args: Vec<Val>` and forwards them to `deploy_v2`. A constructor signature change
is TS-only, so no factory redeploy — as `CLAUDE.md` §2 and `docs/soroban-smart-contracts.md` §4 both
now state.

**Prior art:** `origin/157-contract-swapper-soroswap-amm` (commit `0b8ea30`) already attempted this
and touches almost exactly these files. It is from June 2026, **426 commits behind `develop`, never
merged**, and issue #157 was closed `needs-clarification`. Its quote → slippage → deadline →
`try_invoke_contract` sequence and its `MockRouter` test double are worth lifting wholesale. Its
missing authorization is almost certainly why it was never merged. Mine it; do not merge it.

**Done when:** a swapper flow built in the visual builder deploys to testnet and a triggered swap
routes through the **real** Soroswap testnet router — not a mock — verifiable on stellar.expert.

**Evidence to capture** — live app URL, screen recording of deploy + trigger, swap tx hash, wasm hash.

| Item                     | Value |
| ------------------------ | ----- |
| Testnet app URL          |       |
| Swap tx hash             |       |
| Swapper contract address |       |
| Swapper wasm hash        |       |
| Screen recording         |       |

---

## D2 — Developer API for the swapper

Week 2.

**Decide before Week 2 — what does "execute a swapper" mean?**

The swapper has no execute entrypoint. Its only money-moving function is `receive_and_forward`, and
it fires when the contract **receives funds** — normally called by an upstream contract inside the
same transaction, never by an off-chain caller. Nor can the relayer call it directly: only four
contracts expose a relayer-authorized entrypoint (`payroll::charge_by_relayer`,
`subscription::charge_by_relayer`, `subscription_dev::charge_by_relayer`,
`timelock::release_by_relayer`), and the swapper stores no `Relayer` key at all.

There is exactly one server-drivable path that already works, and it is the right answer:

> **`webhook::execute_escrow`.** It requires **only** `relayer.require_auth()` — no user signature at
> request time — and distributes the webhook contract's own balance to every `next_step`, calling
> `receive_and_forward` on each. `lib/stellar/trigger.ts` `submitWebhookExecuteTx` already signs it
> with the relayer and submits, driven from `app/api/webhooks/[id]/route.ts`. And
> `webhook → swap` is an explicitly supported topology in `lib/flows/validate.ts`.

So `/execute` is a thin wrapper over the escrow path: the user pre-funds the webhook contract with
**one** wallet signature, and the partner's backend then fires swaps with no signature at all. Zero
contract changes, non-custodial, and it matches the story the SOW is selling.

Two consequences to accept explicitly: the endpoint executes a **pipeline**, not a swapper (name it
accordingly), and it only works for flows whose trigger is a webhook. The alternatives are worse —
returning an unsigned XDR is not "execute" and keeps the partner's wallet in the loop, and adding a
relayer entrypoint to the swapper is contract work the out-of-scope list forbids.

**Tasks** — ordered by risk

- [ ] Settle the execute semantics above and write it into the API docs. Everything else depends on it.
- [ ] **Deployment-scoped API tokens.** `DevApiToken` (`prisma/schema.prisma`) is scoped to a
      **User**, with no scopes and no expiry. Needs a schema change **and a migration**. Mirror
      `DevApiToken`'s hashed-token design — do **not** copy `Deployment.webhookSecret`, which is
      stored in plaintext.
- [ ] **An execution-record table.** `Deployment.idempotencyKey` is `@@unique([ownerId, idempotencyKey])`
      — one key per deployment, sized for deploy-once semantics. A repeatable `/execute` needs its own
      table keyed on `(deploymentId, idempotencyKey)`, mirroring `PayrollRun`. Not in the SOW.
- [ ] `POST /api/v1/deployments/[id]/execute`. Note `app/api/deployments/[id]/invoke/route.ts`
      already exists and means "unsigned XDR for streamer lifecycle ops" — a sibling `execute` with
      opposite semantics will confuse integrators. Name and document the difference.
- [ ] `GET /api/v1/deployments/[id]/events` — cursor-based. Reuse the opaque `(occurredAt, id)`
      cursor in `lib/payroll/event-feed.ts` (`paginate()`); today's
      `app/api/deployments/[id]/poll-events/route.ts` is session-only with a fixed `take: 50`.
- [ ] A `withApiV1` wrapper. The primitives are all there — `requireDevApiToken` / `requireSession`
      (`lib/auth.ts`), `rateLimit` / `enforceRateLimit` / `clientIp` (`lib/rate-limit.ts`), `audit()`
      (`lib/audit.ts`), `AppError` / `withErrorHandler` (`lib/errors.ts`) — but every route calls them
      by hand. The wrapper is the actual deliverable.
- [ ] Add new members to `AuditAction` (`lib/audit.ts`) — it is a closed union.
- [ ] `middleware.ts` — add `/api/v1/*` to `PUBLIC_PATHS`. See the security gate below.
- [ ] Codify the response envelope: `{ data: T }` on success, `{ error: { code, message, fields? } }`
      on failure. 106 of 128 handlers already do this; the stragglers (`balances`, `status`) return
      bare objects and plain-text 401s. Note `withErrorHandler` maps `UPSTREAM_RPC → 502`, which for
      `/execute` means "the chain rejected it" — spell that out for partners.
- [ ] Route tests. **The pattern already exists** — six handler tests in `tests/unit/api/`;
      `payroll-events.test.ts` is the closest template (mock `@/lib/db` + `@/lib/auth`, import the
      handler, fabricate a `NextRequest`). Worth knowing: `trigger`, `submit-trigger`, `invoke`,
      `submit-invoke` and `webhooks/[id]` — the endpoints nearest to `/execute` — have no tests at all.
- [ ] OpenAPI spec + Postman collection. No tooling and no dependency exists. Request schemas are
      route-local and **response schemas do not exist at all** except `FeedResponseSchema`, so
      generation means authoring response schemas for every endpoint first. Hand-writing the spec at
      this size avoids a new dependency and is probably faster.
- [ ] API docs with copyable `curl` examples.

**Security gates.** Two open issues sit directly in this deliverable's path:

- **[#247 `[SEC-3]`](https://github.com/webnxt-2030/pinkraft/issues/247)** — when the shared
  `x-dev-api-secret` is used, `requireDevAuth` returns `{ user: null }` and routes drop the ownership
  filter (`where: user ? { id, ownerId: user.id } : { id }`), making it a global-scope credential.
  Deployment-scoped tokens are literally the fix that issue proposes. **D2 closes #247** — say so in
  the PR.
- **[#248 `[SEC-6]`](https://github.com/webnxt-2030/pinkraft/issues/248)** — 11 machine-auth
  financial routes already bypass middleware auth via `PUBLIC_PATHS`. A wildcard `/api/v1/*` prefix
  is broader than any of them. Do not let route-level auth be the only layer.

Also note `trigger`, `submit-trigger`, `invoke` and `submit-invoke` are **all unauthenticated and
not owner-scoped** today — anyone holding a deployment UUID can build an XDR against it. Tolerable
while the XDR is unsigned and drains the caller's own account; **not** tolerable for a
relayer-signed `/execute`. Run the [§10 checklist](../CLAUDE.md#10-security-checklist-per-pr) on
every route here.

**Done when:** an authenticated `curl` from outside the app causes a real swap on testnet and
returns a tx hash, and the events endpoint pages through that deployment's `ContractEvent` rows.

**Evidence to capture**

| Item                                   | Value |
| -------------------------------------- | ----- |
| Public API base URL                    |       |
| OpenAPI spec / Postman collection      |       |
| `curl` transcript (request + response) |       |
| Tx hash from an API-triggered swap     |       |
| Sample `AuditLog` row                  |       |

---

## D3 — Reusable builder inputs

Week 3. `components/builder/config-panel.tsx` is a single **2799-line** component with all 14 node
types as inline `{node.type === "…" && …}` branches. There is no per-node panel registry.

**Decide before Week 3 — three of the four primitives have no home in the Swapper panel.**

The swap branch renders exactly three controls: Asset In, Asset Out, and a bps number field. After
D1 it renders Asset In, Asset Out, slippage bps, and a router address. Against the SOW's four
primitives:

| Primitive       | Home in the Swapper panel?                                                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssetSelect`   | **Yes** — two fields. The only genuine adoption, and it is _extraction_: `AssetSimpleSelect` → `AssetField` → `AssetSelectOrReadout` is ~130 lines already written. Careful — `AssetSelectOrReadout` fires `onChange` from a `useEffect` on mount, so it is not a pure controlled input.                      |
| `ShareInput`    | **Nominally** — slippage is bps-shaped. But the split's share input round-trips `bpsToPct` → `toFixed(1)` → `pctToBps`, which turns 5 bps into 10 bps. Reusing it verbatim **silently doubles the user's slippage tolerance.** It also clamps `min 0` and carries "shares sum to 100%" semantics.             |
| `AddressPicker` | **No.** Only if `routerAddress` is a free-text field — which Decision 5 says it must not be. And `address-input.tsx` validates with `StrKey.isValidEd25519PublicKey`, so it **rejects a `C…` contract address**: a valid Soroswap router would render as invalid. An allowlist `<select>` is the right shape. |
| `AmountInput`   | **None.** There is no amount field in `SwapAction` before or after D1. Its real consumers are `pay`, `split`, `subscription`, `payroll`, `condition` and `on_receive` — all out of scope this sprint.                                                                                                         |

So "Swapper panel only" guarantees that two of the four primitives ship with **zero call sites**.
Either accept that (build all four, adopt two, land the rest next sprint) or widen adoption to the
`split` panel so `AmountInput` and `ShareInput` are actually proven. Say which in the PR.

**D3 depends on D1.** The swap block is `hidden: true` in `palette.tsx`, so no swapper flow can be
built in the builder at all today. Both D3 evidence artifacts — before/after panel screenshots and a
recording of building a swapper flow — are unobtainable until D1's unhide lands.

**Tasks**

- [ ] Stand up component-test infrastructure **first**. `vitest.config.ts` is `environment: "node"`
      with `include: ["tests/unit/**/*.test.ts"]`, so a `.test.tsx` is **silently not collected** —
      it does not error, it reports green. That is the exact failure mode that would produce a false
      CI report for this deliverable. Needs `jsdom`, `@vitejs/plugin-react`, `@testing-library/react`
      (v16 for React 19), `@testing-library/dom`, `@testing-library/jest-dom`, plus a jsdom setup
      file. Watch the aliases: `config-panel.tsx` transitively imports `@prisma/client` for
      `TemplateKind` and will need a stub like the existing `server-only` / `@/lib/env` ones.
- [ ] Create `components/builder/inputs/` and extract the asset primitives out of `config-panel.tsx`.
- [ ] Build `AmountInput` (stroops as `string`, never `number` — [§3.3](../CLAUDE.md#33-typescript))
      and `ShareInput` (bps, clamped) with a **lossless** bps round-trip, not the split's `toFixed(1)`.
- [ ] Build the router field as an **allowlist select**, not an address text input.
- [ ] Adopt what genuinely fits in the `node.type === "swap"` branch.
- [ ] Define the `.input` class. It is used on every control in the panel and **is not defined
      anywhere** — not in `app/globals.css`, not in `tailwind.config.ts`. Today it works only as a
      marker for the `[&_.input]:!border-error/70` error selector. Any "unify the inputs" work has to
      start here, and it is not in the SOW's task list.
- [ ] Unify error **rendering** — not validation. Validation is already centralised: the panel
      re-runs whole-graph `validateFlow(graph)` and maps Zod issue paths onto fields. What is
      inconsistent is markup: four different error renderings exist (`Field` at `text-[11px]`,
      `ApiFillField`, hand-rolled `text-[10px]` spans, and a `role="alert"` paragraph), all four of
      the divergent ones inside `SplitRecipientsEditor`. The swap branch already uses `Field`
      correctly, so this task is a no-op unless scope widens.
- [ ] Accessibility. Scope honestly: across 2799 lines there are **0** `aria-*`, **0** `htmlFor`,
      **0** `id` on inputs, and 2 `role="alert"`. `Field`'s wrapping `<label>` gives implicit naming,
      but there is no `aria-invalid`, no `aria-describedby`, and `ApiFillField` drops the `<label>`
      entirely so those fields have **no accessible name**. Fixing this means changing `Field`, which
      every panel uses — it is not containable to the Swapper branch. `canvas-config-panel.tsx` is
      worse (no dialog role, no focus trap, no Escape handler, drag header not keyboard-operable) and
      is not in the Swapper branch at all. `address-input.tsx` is the one well-covered component —
      use it as the model.
- [ ] Mobile. Zero `sm:`/`md:`/`lg:` classes in either panel; `canvas-config-panel.tsx` hardcodes
      `w-80` in **flow space**, so above ~1.2 zoom it exceeds a 412px viewport and the clamping logic
      cannot rescue it. The committed `screenshots/11-builder-mobile.png` already shows the builder
      overflowing ("EPLOY", "ISH PREVIEW"). Issue
      [#62](https://github.com/webnxt-2030/pinkraft/issues/62) is open and P1 but describes the old
      three-column layout — re-scope it against the current floating panel before working it.
- [ ] Add a screenshot case that opens a swap node's config panel. `tests/e2e/screenshots.spec.ts`
      never opens a config panel in any of its 9 shots, and files are overwritten in place, so
      "before/after" needs distinct filenames or a git-diff-of-binaries workflow.
- [ ] Component tests for the new primitives.

**Done when:** the Swapper config panel renders shared primitives for the fields that have them,
error markup is consistent, and component tests run green in CI **on a runner that actually collects
them**.

**Evidence to capture**

| Item                                          | Value |
| --------------------------------------------- | ----- |
| Before/after screenshots of the Swapper panel |       |
| Screen recording of building a swapper flow   |       |
| CI run showing component tests green          |       |

---

## Not in the SOW — decide before Week 1

Six items the codebase audit turned up that the SOW's deliverable text does not name. Each is real
work. Decide them now rather than discovering them mid-sprint.

| #   | Item                                                                                                                                                                                                                                                                                                                                                          | Cost if ignored                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Nothing in this repo authorizes an outbound token pull.** The router pulls `asset_in` from the swapper, which needs `env.authorize_as_current_contract` + `InvokerContractAuthEntry`. Zero occurrences across all 21 crates; every `approve` in contract code is a revocation. Branch 157 omits it too, and its tests hide the gap behind `mock_all_auths`. | The demo passes green in CI and fails against the real router. This is the single largest unknown in D1 and the reason to spike it on day 1.                                                          |
| 2   | **The SOW's `parentAddress` fix is backwards.** `swapper` and `yield` are the only two pipeline contracts lacking `parent: Address`, and so the only two whose `receive_and_forward` is unauthenticated. Removing the arg from TS closes the arity error; adding the field to Rust closes the hole.                                                           | Following the SOW literally ships the one unauthenticated contract in the pipeline, on the deliverable that moves real money.                                                                         |
| 3   | The `rateBps` → `slippageBps` graph change. `migrateFlowGraph` already exists and runs before parsing, so this is a task, not a risk — **provided it gets done**.                                                                                                                                                                                             | Skipped, `app/flows/[flowId]/page.tsx` `safeParse`s to an empty graph: the builder opens a blank canvas and the next save wipes the flow. Four other paths `.parse` and 500.                          |
| 4   | **No Soroswap router address exists** in the repo or `.env.example`, and our only known pair is XLM ↔ Circle testnet USDC.                                                                                                                                                                                                                                    | If no testnet pool exists for that pair, the "≥ 5 swaps through the Soroswap router" metric is unreachable without seeding liquidity ourselves. Confirm before Week 1.                                |
| 5   | The SOW has the user **pick the router in the config panel** — a user-supplied contract address the swapper will then call.                                                                                                                                                                                                                                   | The on-chain analogue of the SSRF rule in [§18](../CLAUDE.md#18-forbidden-patterns). Needs an allowlist, not a free-text field.                                                                       |
| 6   | Naming the field `router` collides with `TemplateKind.ROUTER` / `contracts/conditions/router`, a **threshold branch router** with its own `case "router"` in the same `scval.ts` switch.                                                                                                                                                                      | Two unrelated "routers" in one file. Use `routerAddress`, matching the existing `vault`/`relayer`/`treasury` convention.                                                                              |
| 7   | The swapper's forward loop sends the **full** `amount_out` to each next step rather than splitting.                                                                                                                                                                                                                                                           | Latent with one downstream, wrong with two — and it panics inside the SAC transfer rather than returning `InsufficientOutput`. Branch 157 makes it worse.                                             |
| 8   | `yield` has the **same** `scval.ts` arity bug, one case below the swapper.                                                                                                                                                                                                                                                                                    | A known-broken sibling left one line from the fix. Cheap to include; decide, don't overlook.                                                                                                          |
| 9   | Unhiding swap means editing `lib/ai/prompts.ts` in **8 places**, including the JSON template the model emits with `rateBps` baked in.                                                                                                                                                                                                                         | The assistant emits swap configs that fail Zod, or keeps refusing to build swap flows at all.                                                                                                         |
| 10  | `docs/design/2026-06-24-dev-mode-mutable-flows.md` records a prior decision: "**Do NOT rewrite the swapper.**"                                                                                                                                                                                                                                                | Not superseded — it is a live design record and that decision has never been reversed. It is also the only written rationale for the current design, and D1 reverses it. Confirm that is intentional. |
| 11  | **D2:** the swapper has no relayer entrypoint, so `/execute` must ride on `webhook::execute_escrow` — meaning it executes a _pipeline_ and only works for webhook-triggered flows.                                                                                                                                                                            | Promising "execute the swapper flow from their own backend" without this caveat oversells the integration.                                                                                            |
| 12  | **D2:** deployment-scoped tokens need a **Prisma migration**, and a repeatable `/execute` needs its own execution-record table — `Deployment.idempotencyKey` is unique per deployment, sized for deploy-once.                                                                                                                                                 | Two unbudgeted schema changes in a deliverable the SOW frames as route work.                                                                                                                          |
| 13  | **D2:** adding `/api/v1/*` to `PUBLIC_PATHS` widens the regression [#248](https://github.com/webnxt-2030/pinkraft/issues/248) already tracks, and `trigger`/`invoke`/`submit-*` are all unauthenticated and not owner-scoped today.                                                                                                                           | A relayer-signed endpoint cannot inherit that posture. Design the guard before writing the route.                                                                                                     |
| 14  | **D3:** `AmountInput` has no field to adopt in the Swapper panel, and `AddressPicker`'s only candidate field is one Decision 5 says must be an allowlist. `address-input.tsx` also rejects `C…` contract addresses.                                                                                                                                           | Two of four primitives ship with zero call sites, and the Done-when is satisfiable only by not using them.                                                                                            |
| 15  | **D3:** the a11y fix means changing `Field`, which all 14 panels use, and the worst gaps are in `canvas-config-panel.tsx` — neither is in the Swapper branch.                                                                                                                                                                                                 | "Accessibility pass, Swapper panel only" is not a coherent unit of work. Pick the wider scope or narrow the claim.                                                                                    |
| 16  | **D3:** a `.test.tsx` is not in vitest's `include`, so a component test is **silently skipped, not failed**.                                                                                                                                                                                                                                                  | CI reports green on tests that never ran — the worst possible outcome for evidence whose whole purpose is a CI report.                                                                                |
| 17  | **D3:** the `.input` class used by every control is not defined anywhere in the repo.                                                                                                                                                                                                                                                                         | Any real input-unification work starts with defining it; it is absent from the SOW's task list.                                                                                                       |
| 18  | `react-hook-form` and `@hookform/resolvers` are both in `dependencies` with **zero usage** anywhere. `README.md` and [`CLAUDE.md` §6](../CLAUDE.md#6-validation) describe a resolver pattern the code does not use.                                                                                                                                           | Do not "restore" a pattern that never existed. Two dead runtime deps; add to docs-audit issue #370.                                                                                                   |

Also worth noting: none of D1/D2/D3 has a tracking issue. #157 (swapper) was closed
`needs-clarification` in June. [§17.5](../CLAUDE.md#17-process) wants one issue per work item.

---

## Success metrics

Fill the `Actual` column as the sprint runs; this is what the Chapter Lead checks.

Most of this is already automated and the SOW does not mention it: **`/admin/submission-proof`**
(`lib/admin-stats.ts` `getSubmissionProof`) reports deployment count, wallet-connection total,
unique wallet addresses, and recent on-chain interactions, with JSON and CSV download links. Three
small additions would complete the table: a total `contractEvent.count()`, a count grouped by
`templateKind` (for swapper executions), and the deployed-template list. That turns this section
from manual bookkeeping into a screenshot.

| Metric                                   | Target | Actual |
| ---------------------------------------- | ------ | ------ |
| Unique flows deployed                    | ≥ 5    |        |
| Distinct wallets deploying               | ≥ 6    |        |
| Contract executions / events published   | ≥ 60   |        |
| Unique swapper flows executed on testnet | ≥ 5    |        |
| Contract wasm uploaded                   | ≥ 1    |        |
| Public testnet URL live and accessible   | Yes    |        |
| Demo video published                     | Yes    |        |

---

## Evidence handoff checklist

Week 4. The Chapter Lead marks each row; every gap here is a gap in the deliverable.

| Deliverable                                | Present | Partial | Missing | Comments |
| ------------------------------------------ | :-----: | :-----: | :-----: | -------- |
| D1 — swapper, real DEX                     |    ☐    |    ☐    |    ☐    |          |
| D2 — developer API                         |    ☐    |    ☐    |    ☐    |          |
| D3 — reusable builder inputs               |    ☐    |    ☐    |    ☐    |          |
| Validation package (video, guide, tx list) |    ☐    |    ☐    |    ☐    |          |

Week 4 also covers: end-to-end test with an external wallet, the 3–5 minute technical demo video,
an integration guide with `curl` examples and sample XDR payloads, the compiled tx-hash list, and a
final `pnpm typecheck && pnpm test && pnpm build` pass.

---

_Codebase references above were verified against `develop` at `4aeab87` on 4-Sep-2026. Line numbers
in `components/builder/config-panel.tsx` will drift; symbol names are given so they stay findable._
