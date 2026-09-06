# Swapper: real DEX swap through the Soroswap router

> **Decided 2026-09-05. Not yet built.** This record fixes the scope of Instawards
> Deliverable 1 after checking every claim in
> [`../instawards-phase-1-sow.md`](../instawards-phase-1-sow.md) §4.1 against the
> code and the live Soroswap testnet router. The SOW is the contract and is not
> edited; where this record narrows or extends its wording, that is stated here.
> For what the swapper does today, read `contracts/actions/swapper/src/lib.rs`
> — not this file.

**SOW:** Deliverable 1, `docs/instawards-phase-1-sow.md` §4.1 / §5.1 Week 1
**Date:** 2026-09-05

## Problem

The swapper contract computes `amount_out = amount * rate_bps / 10_000` and pays it
out of an `asset_out` balance the admin pre-funded with `top_up`. Nothing is
exchanged; the comment in the contract says so. The block is hidden in the palette,
and even if unhidden it cannot deploy: `lib/stellar/scval.ts` serializes six
constructor arguments for a five-argument constructor. The SOW commits to replacing
the simulation with a real swap through the Soroswap testnet router and producing a
swap transaction hash as evidence.

Validation of the SOW's description found its diagnosis accurate and its
prescription incomplete. Five things it does not mention decide whether a swap
succeeds:

1. **Contract-as-payer authorization.** The router calls `to.require_auth()` and
   then `token.transfer(from = to, …)` one frame deeper. Invoker auth covers the
   first, not the second. The swapper must pre-authorize the transfer with
   `authorize_as_current_contract`, and the entry must name the pair address and
   the exact input amount. Soroswap's own aggregator never exercises this
   pattern; nothing first-party shows a contract swapping its own balance.
   **Settled 2026-09-05 by a local spike** — see "Auth spike result" under
   Design.
2. **Router address resets.** Soroswap redeployed its testnet router on 2025-06-19,
   2025-07-18, 2025-08-15 and 2025-12-22. A hardcoded or user-typed address goes
   stale.
3. **Forwarding is wrong for more than one next step.** The current loop transfers
   the full output to every next step and calls `receive_and_forward` on each, so a
   second edge makes it revert. The SOW's phrase "calling `receive_and_forward` on
   each next step exactly once" describes that loop.
4. **No authentication.** `receive_and_forward` ignores `from`, has no
   `require_auth`, and stores no parent. Anyone can force a swap of whatever the
   contract holds.
5. **Missing `execute_step`.** Every other action forwards to its child via
   `execute_step`, so a swapper placed after a splitter, timelock or conditional
   fails at dispatch.

Three things the SOW lists are smaller than they read: a Swapper config panel
already exists (`components/builder/config-panel.tsx`, `swap` branch); swap event
decoding and the live-event renderer already exist; and the
`validate.ts` `TemplateKind` label is cosmetic because the per-node pipeline already
resolves the swap node to `SWAPPER`.

## Goals

1. A swap node deploys through the factory and, when triggered, executes
   `swap_exact_tokens_for_tokens` on the Soroswap router with slippage protection,
   then forwards the output to its single downstream node.
2. The router address comes from the environment, so a Soroswap testnet reset is a
   config change, not a contract or graph change.
3. The contract follows the conventions of its siblings: `ParentNode` storage,
   `execute_step` authenticated by the parent, `receive_and_forward` authenticated by
   `from`, `bump_ttl`, forward to `next_steps[0]` via `execute_step`.
4. Existing event decoding keeps working: the `swap` event keeps its shape,
   `("swap", asset_in, asset_out) -> (amount_in, amount_out)`.

## Non-goals

- **No new asset kind.** Soroswap's _listed_ testnet USDC is a Soroswap-issued
  Soroban token with no classic issuer, which `AssetSchema` cannot represent.
  Checked on 2026-09-05 by simulating `router_get_amounts_out`: a pool for XLM
  against **Circle's** testnet USDC (Paiflow's existing `known` USDC) exists with
  roughly 417k USDC and 3.94M XLM in reserves (USDC is the pair's `token_0`) and about 0.3% impact on a 10,000 XLM
  swap. The swapper uses that pool. Adding contract-id assets would touch
  `AssetSchema`, SEP-7 URIs, notifications and the asset select, and was rejected
  for this sprint.
- **No user-selectable router.** The SOW says "router selector"; the panel shows a
  read-only "Router: Soroswap (testnet)" line and the address is injected
  server-side at deploy time. A free-text address widens the trust surface and
  breaks every flow on a reset.
- **No multi-output swap.** A swap node may have at most one outgoing edge. Splitting
  is the splitter's job.
- **No `SWAPPER_DEV` variant**, no relayer-driven swap, no `top_up`. Once the swap is
  real there is no pre-funded balance to top up. In a dev-mode flow the swapper stays
  immutable beside its `_DEV` siblings: dev mode leaves nodes without a `_DEV`
  counterpart unchanged ([dev-mode design record](./2026-06-24-dev-mode-mutable-flows.md) §1).
- **No client-supplied quote.** The trigger path is `deposit()` on the trigger
  contract, so there is nowhere for an off-chain quote to travel. `amount_out_min`
  is computed in-transaction from the pool's **spot** price, so `slippage_bps`
  bounds Soroswap's 0.3% fee plus price impact and rejects a thin or manipulated
  pool. It does not protect against front-running within the same ledger; that
  limitation is accepted and stated in the user-facing copy. (Quoting
  `router_get_amounts_out` in the same transaction, the original plan, was a
  tautology: the router computes its actual output with that same call on the same
  reserves, so the check could never fail. Corrected 2026-09-06.)

## Design

### Contract — `contracts/actions/swapper`

Constructor, in sibling order (parent before next steps):

```
admin, asset_in, asset_out, slippage_bps: u32, router: Address,
deadline_secs: u64, parent: Address, next_steps: Vec<WorkflowTarget>
```

`slippage_bps` must be `<= 10_000`. Storage replaces `RateBps` with `SlippageBps`,
`Router`, `DeadlineSecs`, `ParentNode`.

Entry points:

- `execute_step(asset, amount)` — `bump_ttl`, `parent.require_auth()`, `do_swap`.
- `receive_and_forward(from, asset, amount, _next_steps)` — `bump_ttl`,
  `from.require_auth()`, `do_swap`.

`do_swap`:

1. Reject `asset != asset_in` and `amount <= 0`.
2. `pair = factory.get_pair(asset_in, asset_out)` with `factory = router.get_factory()`;
   `(r0, r1) = pair.get_reserves()`, oriented by `pair.token_0() == asset_in`;
   `spot_out = amount * reserve_out / reserve_in`, checked math.
3. `amount_out_min = spot_out * (10_000 - slippage_bps) / 10_000`, checked math. The
   default is 100 bps; anything under 30 bps always fails on the fee.
4. `authorize_as_current_contract` for `asset_in.transfer(self, pair, amount)`, using
   the pair address from step 2.
5. Call the router with `to = self` and `deadline = ledger.timestamp() + deadline_secs`:
   `swap_exact_tokens_for_tokens(amount, amount_out_min, path, to, deadline)`. The
   router's deadline check is `>=`, so `deadline_secs` must be at least 1.
6. `amount_out = amounts.last()`; assert `amount_out >= amount_out_min` and
   `amount_out > 0` (`InsufficientOutput`), the swapper's own backstop behind the
   router's check. Transfer it to `next_steps.first()` and invoke
   `execute_step(asset_out, amount_out)` on it, the splitter pattern. A swap with no
   next step keeps the output in the contract for the admin.
7. Emit `("swap", asset_in, asset_out) -> (amount, amount_out)`.

#### Auth spike result (2026-09-05)

A throwaway crate outside the repo (soroban-sdk 26.1.x, test env **without**
`mock_all_auths`) reproduced the router's auth-relevant lines — `to.require_auth()`,
the `>=` deadline check, then `token(path[0]).transfer(&to, &pair, &amount_in)` —
and had a caller contract swap its own balance. Seven tests, all green:

- With the entry below, the swap succeeds and balances move as expected.
- Without `authorize_as_current_contract`, the nested transfer is rejected. The test
  env enforces auth, so the positive result is meaningful.
- An entry naming a **wrong pair address** or a **wrong amount** is rejected. The
  entry must match the router's internal call exactly.
- `deadline == ledger.timestamp()` fails; the router check is inclusive.

The entry that worked, from inside the swapper, where `me` is
`env.current_contract_address()`:

```rust
env.authorize_as_current_contract(vec![&env,
    InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext {
            contract: asset_in.clone(),
            fn_name: Symbol::new(&env, "transfer"),
            args: (me.clone(), pair.clone(), amount_in).into_val(&env),
        },
        sub_invocations: vec![&env],
    }),
]);
```

Two corrections to the reasoning above. The amount in the entry is `amount_in`
itself, which the swapper already knows; for an exact-in swap `amounts[0] ==
amount_in`, so no router quote is needed for the auth entry (and, since the
spot-price decision above, none is needed for `amount_out_min` either). And the pair address is required before the swap: obtain it with
`factory.get_pair(asset_in, asset_out)` where `factory = router.get_factory()`, or
compute it with Soroswap's `pair_for`. The `#[contractclient]` trait approach for
the router compiled and worked in the spike. Spike source is attached to issue
#390.

**Confirmed live on 2026-09-06.** A standalone swapper built from the rewritten crate
(`CDEEJZG6DYN65DTZLS6WU7YJ3I4RJ4TSOHF5VXEFO7PTTHWRNREPDOOU`) swapped its own 10 XLM
through the real testnet router in tx
`5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673`, receiving
1.0562889 USDC; the same code then ran inside a factory-deployed pipeline (tx
`4d99fec3ebc93abee20ebe105545f93a94f1ea929a8245e9e678bab9fbd26838`). Evidence and
the eleven findings are in the verification copy `SaltinStillWaters/pinkraft-d1`,
`docs/evidence/d1/VERIFICATION.md`.

The router client is a hand-written `#[contractclient] trait SoroswapRouter` with
the two functions above. `soroswap-router` is not on crates.io and the router crate
is `cdylib`-only, so there is nothing to depend on. Testnet router at time of
writing: `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`; the canonical
list is `soroswap/core` `public/testnet.contracts.json`.

Tests use a mock router in the crate's test module (returns a fixed quote and moves
tokens), covering the happy path, slippage revert, deadline, unauthenticated caller,
wrong asset, and more than one next step. `crate-type` gains `rlib` so the mock is
reusable.

### TypeScript

- `lib/flows/schema.ts` `SwapAction.config`: `assetIn`, `assetOut`, `slippageBps`
  (int, 0–10_000, default 100), `deadlineSecs` (int, default 300). The router is not
  on the graph.
- `lib/env.ts`: `STELLAR_SOROSWAP_ROUTER_TESTNET` / `_MAINNET` and a
  `soroswapRouterAddress()` helper; mainnet may be unset. Listed in `.env.example`.
- `lib/flows/to-params.ts`: `SwapperNodeParams` carries `slippageBps` and
  `deadlineSecs`; `lib/stellar/deploy.ts` injects the router the way it injects the
  relayer address.
- `lib/stellar/scval.ts`: eight arguments in constructor order. The `yield` branch
  has the same spurious trailing `parentAddress`; out of D1 scope, tracked in #392.
- `lib/flows/validate.ts`: a swap node may have at most one outgoing edge; the
  `templateKind` ladder labels swap and yield flows `SWAPPER` / `YIELD`.
- `components/builder/palette.tsx`: unhide; default `slippageBps: 100`.
- Simulation preview (SOW §5.1 Week 1 output): a session-guarded, rate-limited
  `GET /api/soroswap/quote` that simulates `router_get_amounts_out` for the expected
  output and reads the pair's reserves for the spot-based minimum the contract will
  enforce, surfaced in the swap panel and on the deploy review. Read-only; never cached at the framework layer.
- Router selector (SOW wording): a disabled one-option `<select>` labelled by network;
  the value never leaves the client and the address always comes from env.
- `components/builder/config-panel.tsx`: slippage as a percent input, deadline in
  seconds, read-only router line. Deliverable 3 replaces these with shared inputs.
- `lib/flows/english.ts`, `lib/flows/template-labels.ts`,
  `lib/stellar/soroban-errors.ts`: copy and error codes follow the contract.
- Unit tests: `scval` (swapper), `validate` (single edge, template kind, dev-mode flow
  with a swap), `english`, `to-params` (param shape; dev-mode flow keeps `SWAPPER`).

### Operations

Before the first testnet deploy, and after any Soroswap reset, confirm the pool:
simulate `router_get_amounts_out(10_0000000, [XLM SAC, USDC SAC])` against the
router. A `scripts/soroswap-check.ts` that prints router, pair and reserves makes
this repeatable for the evidence pack.

## Verification

1. `cargo test -p paiflow-swapper` and `cargo clippy --all-targets -- -D warnings`
   green.
2. `pnpm test` for the four unit suites above and `pnpm typecheck` green.
3. On testnet: build `on_receive XLM → swap → pay USDC` in the builder, deploy, fund
   the trigger, and confirm on stellar.expert a `swap` event from the swapper and a
   `swap_exact_tokens_for_tokens` sub-invocation on the Soroswap router. That
   transaction hash is the SOW evidence.
4. Negative: `slippageBps: 0` reverts on the pool fee alone (the minimum is the spot
   output; the fee drops the real output below it), and the failure surfaces as a
   friendly router error in the deploy UI.
