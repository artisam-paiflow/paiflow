# Instawards Phase 1 — overview

A 30-day, $5,000 SDF Instaward (Philippines chapter) to close three engineering gaps that keep
Paiflow from being partner-ready on testnet — and to prove it closed them.

Paiflow is already live: the factory is deployed and six flow templates deploy and execute on-chain.
This award is not about building the product.

**8-Sep → 7-Oct-2026** · Testnet only · No mainnet, no new contract templates, no fiat off-ramp

Task-level detail lives in the [build sheet](./instawards-phase-1.md).

## At a glance

| #   | Deliverable             | Week | The point                                                |
| --- | ----------------------- | ---- | -------------------------------------------------------- |
| D1  | Real DEX swap           | 1    | Paiflow composes with Stellar DeFi for the first time    |
| D2  | Partner-drivable API    | 2    | Paiflow becomes something software uses, not just people |
| D3  | Reusable builder inputs | 3    | The next node type gets cheap                            |
| D4  | Validation package      | 4    | The award is judged on evidence, not commits             |

## D1 · Real DEX swap

> Wire the existing swapper contract to the Soroswap testnet router, unhide it in the builder, and
> produce a verifiable swap transaction.

Every Paiflow contract today only _routes_ value it already holds — the splitter fans it out, the
streamer meters it, the payer forwards a slice. None of them change what the value _is_. The swapper
is the first that transforms one asset into another, and it can only do that by calling a protocol
Paiflow does not own.

That is the real milestone: Paiflow stops being a closed set of primitives and starts composing with
Stellar DeFi. Treasury conversion, reward denomination, paying someone in an asset they never
received — all of it sits on this one capability.

**Done when** a swapper flow built on the canvas deploys to testnet and a triggered swap routes
through the real Soroswap router, verifiable on stellar.expert.

## D2 · Partner-drivable API

> A versioned `/api/v1` surface with deployment-scoped tokens, an execute endpoint, cursor-based
> event polling, an OpenAPI spec, and working curl examples.

Today Paiflow is a thing people use. D2 makes it a thing _software_ uses. Centient and Ember do not
want to drag nodes on a canvas — they want their backend to fire a payout and read back what
happened.

Payroll already has a machine interface, but it is one-off, hand-rolled, and specific to payroll. D2
generalises it into something a partner can integrate against by reading docs instead of asking us
questions. It ships no user-visible feature, and it is the precondition for every partner
conversation in the go-to-market plan.

**Done when** an authenticated curl from outside the app causes a real swap on testnet and returns a
tx hash, and the events endpoint pages through that deployment's events.

## D3 · Reusable builder inputs

> Extract shared input components — asset select, amount, address, share — and adopt them in the
> Swapper config panel, with tests and an accessibility pass.

The builder has 14 node types and 14 hand-written config forms living in one 2,800-line file. Each
one invents its own way to ask for an amount, an address, or a percentage, so validation is
inconsistent and error messages differ by panel.

More importantly, every new node type costs more than the last. D3 pays that down: build the inputs
once so the fifteenth node type is cheap and consistent. It is the least visible deliverable and the
one that decides how fast Phase 2 moves.

**Done when** the Swapper panel renders shared primitives, error markup is consistent, and component
tests run green in CI.

## D4 · Validation package

> A 3–5 minute technical demo video, an integration guide with curl examples and sample XDR
> payloads, and every transaction hash compiled on Stellar Expert — plus contract addresses, WASM
> hashes, and a screen recording.

The Chapter Lead does not review pull requests. They review evidence, against the grid in SOW §6.2 —
which carries a row for this package alongside D1, D2 and D3. That makes it a deliverable in its own
right, not paperwork at the end. Work that is finished in the repo but unevidenced is, for the
purposes of this award, not finished.

It is also the artifact that outlives the sprint: the demo video and integration guide are what a
partner sees first.

**Done when** the Chapter Lead can verify all four rows of §6.2 without asking a follow-up question.

**The numbers it carries** — ≥5 unique flows deployed by ≥6 distinct wallets, ≥60 on-chain events,
≥5 swapper executions through the Soroswap router, ≥1 WASM uploaded, a live public testnet URL, and
a published demo video. Most of the counting is already automated by `/admin/submission-proof`,
which exports JSON and CSV.

## Risks

### High

- **Contract-to-contract authorization** — letting the router pull funds from inside the swapper is
  a Soroban pattern no crate here uses yet, and unit tests cannot prove it. The June 2026 attempt
  died on exactly this.

  → Spike it on day 1 with a throwaway contract against the real router, before building anything on
  top. Only a testnet transaction counts as proof.

- **Soroswap testnet liquidity** — no router address exists in the repo, and our only known pair is
  XLM ↔ Circle testnet USDC. If there is no pool, the swap target is unreachable.

  → Confirm the router address and pool on day 1. Fallbacks: seed a pool ourselves, or add
  Soroswap's test tokens as a known asset.

- **D3 is blocked by D1** — the swap block is hidden, so no swapper flow can be built, and both D3
  evidence artifacts depend on building one.

  → Land the palette unhide early in Week 1, before the DEX call works. It is a one-line change plus
  the AI prompt edits.

- **Evidence produced late** — all the code can land and the award still fail its review if the
  artifacts were never captured.

  → Capture tx hashes, screenshots and recordings the moment they happen. Week 4 is for assembly,
  not production.

### Medium

- **Silent test failure** — a `.test.tsx` is not collected by the current runner, so it reports
  green having run nothing.

  → Do the test-infra change first, then prove it by writing a deliberately failing test and
  watching CI go red.

- **Unnamed work** — the SOW's task lists omit roughly a dozen real items: a graph migration, 8
  AI-prompt sites, 14 test fixtures, two schema changes.

  → The build sheet is the real checklist. Treat the SOW's task list as a summary, not an inventory.

- **Security regression** — a versioned API bypassing middleware auth, or a relayer-signed endpoint
  inheriting today's unauthenticated trigger routes.

  → Run the [§10 checklist](../CLAUDE.md#10-security-checklist-per-pr) on every route.
  Deployment-scoped tokens close #247 — do not reopen #248 in the same breath.

- **Single builder, no slack** — 160 budgeted hours is ~6h every working day for a month, one
  person, no bus factor.

  → Week 4 holds 9 days for a ~4-day task list. That is the only buffer; protect it, and do not
  spend it in Week 1.

- **Adoption targets do not accrue passively** — 6 distinct wallets and 60 events will not happen by
  themselves on a testnet app.

  → Line up pilot testers in Week 1, not Week 4. Run every internal test from a real wallet so it
  counts.

## Tips

- **Sequence by risk, not by file.** The two things that can invalidate the plan — router
  authorization and Soroswap liquidity — are both answerable on day 1 and cost nothing to check.
  Everything else is ordinary work.

- **Mine the abandoned branch, do not merge it.** `157-contract-swapper-soroswap-amm` already wrote
  the quote → slippage → deadline sequence and a mock router. It is 426 commits behind `develop`, so
  lift the logic and leave the branch.

- **Distrust green tests on the swap path.** The old branch's tests pass only because
  `mock_all_auths` waves away the authorization step that would fail on-chain. A unit test cannot
  tell you this works.

- **Open the tracking issues now.** None of D1–D3 has one; the swapper issue was closed in June.
  [§17.5](../CLAUDE.md#17-process) wants one per work item, and they double as your progress log.

- **One concern per PR.** A schema change and a UI change are two PRs
  ([§17.4](../CLAUDE.md#17-process)). It keeps review honest and makes the evidence trail readable.

- **Show the Chapter Lead an artifact in Week 1.** A single swap tx hash early is worth more than a
  perfect package late, and it surfaces any mismatch in what they expect to receive while there is
  still time to fix it.

- **Write the integration guide while building D2, not after.** If the curl examples are painful to
  write, the API is painful to use — and that feedback is only useful before the surface is frozen.

- **Keep a running evidence file.** One markdown file, appended to as things happen: every tx hash,
  contract address, and screenshot path. Week 4 becomes assembly instead of archaeology.
