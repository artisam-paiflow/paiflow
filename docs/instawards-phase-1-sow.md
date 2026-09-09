# Paiflow — Instawards Phase 1 Statement of Work

> Statement of Work approved by the Stellar Development Foundation Instawards program
> (Philippines chapter). Submitted 24-Jul-2026. This is the reference for what Phase 1 delivers
> and how it is evidenced; it is reproduced verbatim and is not edited to track the code. Earlier
> pre-approval planning documents were removed on 2026-09-05 and are not a reference.

---

## 1. Project & Team Information

| Field                          | Value                                               |
| ------------------------------ | --------------------------------------------------- |
| Project Name                   | Paiflow                                             |
| Builder / Team Name            | Mychal Andres B. Pejana                             |
| Primary Contact (Name + Email) | Mychal Andres B. Pejana / mychalpejana.mp@gmail.com |
| Ambassador Chapter             | Philippines                                         |
| Ambassador Chapter Lead        | Nelson Lumbres                                      |
| Date Submitted                 | 24-July-2026                                        |
| Suggested Sprint Start Date    | 10-Aug-2026                                         |
| X Account                      | https://x.com/paiflow_xyz                           |
| Live App URL                   | https://paiflow.xyz                                 |
| Github                         | https://github.com/artisam-paiflow/paiflow          |

## 2. Instawards Overview & Intent

### 2.1 Instawards Purpose (for Builder Context)

Instawards are designed to support short, clearly scoped, execution-focused work that helps a
project make tangible progress toward building on Stellar. Instawards are meant to fund specific,
achievable outcomes that can be completed and demonstrated within 30 days or less.

This SOW represents a shared commitment between the Builder and the Ambassador Chapter Lead on
what will be delivered, why it matters, and how success will be verified.

## 3. Problem Statement & Objective

This SOW covers Phase 1 of Paiflow's Instawards roadmap. The primary goal of this phase is to
demonstrate that Paiflow can successfully ship one new contract flow end-to-end — the real-DEX
Swapper — and expose it through a reusable developer interface on Stellar testnet.

Follow-on phases will expand the API to additional flows and adopt shared components across the
full builder.

### Problem Being Addressed

_What specific problem, gap, or blocker is this Instaward intended to solve?_

Paiflow is a visual, non-custodial payment-flow builder on Stellar/Soroban. The app is already live
on testnet, the factory contract is deployed, and core templates (splitter, streamer, conditional,
payer, payroll, subscription) already deploy and execute on-chain.

The blocker this Instaward removes is not the absence of Paiflow, but three specific engineering
gaps that prevent the product from being reliable and partner-ready on testnet:

1. **The swapper is wired but disabled.** The `contracts/actions/swapper` crate exists; the builder
   schema (`lib/flows/schema.ts`), validation (`lib/flows/validate.ts`), pipeline mapping
   (`lib/flows/to-params.ts`), SCVal serialization (`lib/stellar/scval.ts`), and event
   classification (`lib/stellar/events.ts`) are already implemented; and the block is present in
   the palette with `hidden: true`.
   However, the contract currently performs a simulated fixed-rate transfer and does not call a
   real DEX router, so no actual on-chain swap occurs. The block is deliberately disabled pending
   DEX integration and hardening.
2. **The developer API does not yet expose the swapper to external callers.** The existing payroll
   endpoint gives partners a machine-facing integration, but non-payroll flows like the swapper
   rely on ad-hoc `/api/deployments/[id]/trigger` and the `dev-*` endpoints that are
   IP-rate-limited or shared-secret authenticated. There is no deployment-scoped API token model,
   no unified `POST /api/v1/deployments/[id]/execute` surface for the swapper, no cursor-based
   event polling endpoint, and no documented curl examples.
3. **Builder node inputs are not standardized.** Each node type implements its own config-panel
   inputs for assets, amounts, addresses, and shares, creating inconsistent validation, duplicated
   UI code, and confusing error messages for non-technical users.

### Objective of This Instaward

_In one or two sentences, what will be true at the end of 30 days if this Instaward is successful?_

In Phase 1, Paiflow will ship a swapper flow that executes a real on-chain swap through the
Soroswap testnet router, expose that swapper through a developer API extension with
deployment-scoped tokens and execute/events endpoints, and adopt reusable builder input components
for the Swapper config panel — all verified on Stellar testnet with concrete contract addresses,
transaction hashes, and working curl examples.

### 3.1 Go-To-Market Strategy

Paiflow is positioning toward partner integrations with Centient and Ember. Rather than promising
full integrations within this sprint, this Instaward builds the technical foundation those
integrations require: a reusable developer API, a fully functional swapper flow, and a
standardized set of config-panel inputs. After this sprint, Centient can evaluate triggering
swapper flows programmatically, and Ember can evaluate milestone-escrow patterns built on the same
API surface.

| Startup                             | Description                                                                                      | How Paiflow integrates                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Centient ("Train AI, Cent by Cent") | A data-labeling platform that pays contributors micro-payments for completing AI-training tasks. | A machine-facing API that Centient can later use to trigger on-chain payouts without building custom Soroban logic. |
| Ember ("Better Kickstarter")        | A milestone-based, on-chain crowdfunding dApp on Stellar.                                        | A working swapper template and reusable API surface that Ember can later compose into milestone-release flows.      |

### 3.2 Key Outcome

At the end of this sprint, pilot users will be able to:

- Visit the live testnet dApp and connect a wallet.
- Create a swapper flow from the visual builder (select `asset_in`, `asset_out`, `slippage_bps`,
  and `router`).
- Deploy the swapper flow to Stellar testnet without writing Rust.
- Trigger the deployed swapper flow and verify the real DEX swap transaction on stellar.expert.
- Call a developer API endpoint to execute the swapper flow from their own backend.
- Experience consistent config-panel inputs and validation messages in the Swapper panel.

### 3.3 The Gap (Analysis, Current Challenges, and Limitations)

Programmable payments today force a hard trade-off between usability and true decentralization.
Existing solutions are either custodial, EVM-restricted, or require extensive engineering. Paiflow
fills this gap as the first visual, drag-and-drop, non-custodial payment-flow builder on Stellar.

Within Paiflow itself, the remaining gap is surface completeness: the swapper contract exists but
is not yet wired into a real DEX, and the API surface is incomplete.

| Existing Solution                                              | Key Limitation                                                                                                                                                                          | What Your Build Adds                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| SmartDeploy, WebSoroban IDE, Loam, AutoAction                  | Developer frameworks, IDEs, and CLI automation tools that still require Rust/contract knowledge or code-first workflows.                                                                | A no-code builder where operators deploy and compose contracts visually, with wallet-signed transactions and live event feeds. |
| Splito, Paystreme, Subs, P'aid Payrolling, MugglePay, HedgePay | Single-use-case consumer or B2B apps (payments, streaming, subscriptions, payroll, checkout, savings). Each solves one flow type and often abstracts or custodies the blockchain layer. | A composable, non-custodial canvas where operators combine split, stream, condition, and swap blocks across many use cases.    |
| Stripe Connect, Dots, Routable, Tipalti, Modern Treasury       | Custodial or fiat-API-first payout orchestration; fee-stacked, geo-restricted, bank-partnership dependent, and not blockchain-native.                                                   | Non-custodial, programmable on-chain flows with transparent smart-contract logic and no platform hold on funds.                |
| Zapier, Make, n8n, Activepieces                                | Move data between apps; cannot natively settle money atomically.                                                                                                                        | Moves value directly on-chain with atomic settlement and verifiable tx hashes.                                                 |

### 3.4 Existing Approaches

The current market forces a hard trade-off between usability and true decentralization, leaving
non-technical operators behind.

_(For a more comprehensive list of existing solutions, visit Annex A)_

| Platform                                                    | Primary Focus                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Web2 Marketplace Rails (Stripe Connect, Dots)               | Custodial fiat/stablecoin payouts and revenue splits for business platforms.                     |
| Web2 Automation (Zapier, Make)                              | Trigger-action SaaS workflows; off-chain operational integration rather than money settlement.   |
| Crypto-Native Protocols (0xSplits, Superfluid)              | Single-purpose EVM money primitives (e.g., streaming or splitting) delivered via developer SDKs. |
| Developer Infrastructure (thirdweb, OpenZeppelin, CryptoDo) | EVM backend tooling, wallet infrastructure, and contract scaffolding for engineers.              |

### 3.5 Why Stellar

Paiflow's promise is "ship a payment flow in under 90 seconds" — and that promise only holds on a
chain that is fast, cheap, atomic, and built for payments. Stellar is the only L1 where the
economics and UX of micro-scale, programmable money actually work:

- Sub-cent fees and ~5-second finality make per-task micropayments, revenue splits, and streaming
  payouts viable — the exact flows that are uneconomical on EVM chains where a single split can
  cost more in gas than the payment itself.
- Native, atomic asset transfers + USDC mean money flows settle in one operation, all-or-nothing —
  no partial-failure states to reconcile.
- Soroban brings real smart-contract logic (splits, escrow, streaming, conditions) to a chain that
  was already the best at moving money — so Paiflow gets programmability and payment-grade rails
  in one place.
- SEP-7 deep links + mobile wallets make the "scan a QR, sign on your phone, money moves" demo
  native to the platform, not bolted on.

### 3.6 Benefits to the Ecosystem

Paiflow expands who can build on Stellar and what gets built:

- **Onboards non-developers to Soroban.** Today Soroban tooling is Rust IDEs, CLIs, and MCP
  servers — built for engineers. Paiflow is the first visual, no-code surface that lets product
  managers, MSME operators, and creators deploy real Soroban contracts without writing Rust.
- **Drives real on-chain volume and USDC usage.** Every deployed flow is live contract activity —
  splits, streams, escrows, subscriptions — generating recurring transactions and stablecoin
  movement, not just one-off deployments.
- **Showcases Stellar's payment edge.** Paiflow is a concrete proof point that sub-cent fees +
  Soroban make micro-scale programmable payments work where other chains can't — a referenceable
  use case for the network.

### 3.7 Validation Scope and Practical Use Cases

**Validation Scope:** This sprint validates that (a) the existing swapper contract can be deployed
and triggered through the visual builder as a first-class flow that executes a real DEX swap on
testnet, (b) the existing payroll developer API can be extended to support the swapper with
deployment-scoped tokens and documented curl examples, and (c) builder node inputs can be
standardized for the Swapper panel without breaking existing templates. It does not add new
contract templates, introduce oracle dependencies, enable mainnet, build partner-specific
integrations, or integrate a fiat off-ramp.

**Use Cases:**

- **Programmable payouts for platforms:** a partner backend calls the developer API to trigger a
  swapper flow, converting incoming USDC to another SAC asset before distribution.
- **Fixed-rate token conversion:** an operator deploys a swapper flow that absorbs one asset and
  forwards another at a market rate with slippage protection, useful for treasury conversion or
  reward-denomination swaps.
- **Revenue & collaborator splits:** a creator deploys a splitter that auto-fans incoming funds
  across collaborators by share or percentage, on every payment, automatically.

### 3.8 Sprint Constraints & Targets

- **Open & accessible:** delivered as a public repo and a public testnet URL anyone can open, try,
  and inspect.
- **Adoption target:** ≥ 5 unique flows deployed by ≥ 6 distinct wallets through the visual
  builder to testnet.
- **Transaction target:** ≥ 60 on-chain contract executions/events on testnet.
- **Swapper target:** ≥ 5 unique swapper flows executed on testnet through the Soroswap router.
- **Technical target:** swapper deployable end-to-end with a real DEX swap; developer API returns
  signed/submitted transactions for the swapper; Swapper config panel uses shared input
  primitives.
- **Why Instawards:** focuses purely on closing three well-defined engineering gaps in 30 days,
  not open-ended exploration.

### 3.9 Security and Risk Considerations

| Risk                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart-contract logic flaw    | Fixed library unit-tested templates; no arbitrary user code; testnet validated                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Misconfigured flow           | Flow validation + plain-English flow summary before deploy; simulation surfaces the exact effect;                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Factory contract admin key   | The factory contract has an admin/upgrade key controlled by the builder. It is used only for contract upgrades and cannot move user funds. Trust boundary: TTL-gated, allowance-limited operations; future sprint will move to a multisig.                                                                                                                                                                                                                                                                                  |
| Swapper contract call-safety | The swapper delegates the token exchange to the Soroswap Router via `swap_exact_tokens_for_tokens`. It validates the router-returned output amount against `amount_out_min` computed from `slippage_bps`; if the slippage check fails, the swap reverts and no downstream `receive_and_forward` is invoked. After a successful swap, output is forwarded by calling `receive_and_forward` on each next step exactly once with a fresh, empty `next_steps` vector, preventing re-entrant loops from re-entering the swapper. |
| Mainnet money mistakes       | Testnet only. Mainnet deployment is out of scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### 3.10 How it works

```
Operator drags triggers & actions onto the canvas (or use the AI assistant) and wires a money flow
(no Rust)
        ↓
Builder validates the flow & shows a plain-English summary of what the contract will do
        ↓
Backend builds and simulates an unsigned transaction; the operator's wallet signs it
(keys never touch the server)
        ↓
Signed transaction is submitted via Soroban RPC; backend polls until the contract finalizes on-chain
        ↓
Deployment renders a QR / webhook endpoint — a scan, HTTP POST, or schedule fires the contract
        ↓
Contract executes atomically (split / stream / conditional release); live event feed streams payouts — verifiable on stellar.expert
```

## 4. Scope of Work (30-Day Deliverables)

_Important guidance: This scope must be achievable within 30 calendar days. If the work feels
larger, it should be reduced or split into more achievable phases._

### 4.1 In-Scope Deliverables

| Deliverable   | Description (What will be built or produced?)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Why this matters                                                                                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliverable 1 | Integrate the existing swapper contract end-to-end. Update `contracts/actions/swapper` to call `SoroswapRouter::swap_exact_tokens_for_tokens` on the Soroswap testnet router; add `execute_step(asset, amount)`; compute `amount_out_min` from `slippage_bps`; update constructor args to `admin, asset_in, asset_out, slippage_bps, router, next_steps`; fix `lib/flows/validate.ts:1012-1017` so swap/yield flows are not mapped to `TemplateKind.SPLITTER`; fix `lib/stellar/scval.ts` swapper constructor serialization (remove erroneous `parentAddress`, add `router`/`slippage_bps`); unhide the swapper block in the builder palette; build the Swapper config panel; update swapper event parsing and live-event classification; deploy and trigger a swapper flow on Stellar testnet and produce a swap tx hash. | The swapper contract exists but is unreachable to users and performs a simulated transfer. Integrating it with a real DEX proves Paiflow can compose with live Stellar DeFi primitives and gives users on-chain token-swap capability with a verifiable swap transaction for reviewers. |
| Deliverable 2 | Extend the existing developer API to support the Swapper flow. Extract reusable auth, basic rate-limiting, and audit primitives from the existing payroll endpoints; implement deployment-scoped API tokens; build `POST /api/v1/deployments/[id]/execute` for the Swapper action; build `GET /api/v1/deployments/[id]/events` for cursor-based event polling; add unit/integration tests; generate an initial OpenAPI spec and Postman collection; write initial API documentation with copyable curl examples.                                                                                                                                                                                                                                                                                                           | Today only payroll has a machine-facing API. Extending the existing API pattern to the Swapper lets partner backends, scripts, and other dApps trigger a real Stellar DEX swap programmatically without building a new API platform.                                                    |
| Deliverable 3 | Create reusable builder input components and adopt them for the Swapper implementation. Design shared input components (`AssetSelect`, `AmountInput`, `AddressPicker`, `ShareInput`) and adopt them in the Swapper config panel; unify Zod validation schemas and error rendering for the Swapper flow; build the components so they can be reused in other node types in future sprints; add component tests and an accessibility/mobile viewport pass.                                                                                                                                                                                                                                                                                                                                                                   | Standardized inputs reduce duplicated UI code in the Swapper panel, fix inconsistent validation, and make the builder feel cohesive to non-technical users, while laying the groundwork for later adoption across other node types.                                                     |

### Out-of-Scope (Explicitly Not Included)

_List anything that might be assumed but is not included in this Instaward scope._

- **Mainnet contract deployments.** All shipped contracts target Stellar testnet in this cycle.
- **Third-party formal security audit.** Contracts ship with internal unit tests + team review
  only.
- **Production SLA / uptime guarantees** on the public demo URL.
- **Mobile native app.** The web app is responsive but no iOS / Android binary.
- **Token issuance, governance, or DAO mechanics.** Paiflow has no token and will not have one.
- **Multi-chain support.** Stellar / Soroban only.
- **Localisation.** English only.
- **AI / voice assistant features** and any associated API credits (Groq, OpenAI, etc.).
- **Oracle-based triggers or conditions.**
- **x402 / MPP integration.**
- **Splitter and streamer API expansion** beyond what is needed for the Swapper implementation.
- **Full builder-wide UI refactoring;** shared input components are adopted for the Swapper panel
  only in this sprint.
- **Fiat off-ramp provider integration** (MoneyGram Access, PDAX, etc.). The current PDAX off-ramp
  is mocked and its UAT environment is closing after the grand finale. A live provider integration
  is deferred to a follow-on Instaward (Phase 2) once sandbox credentials and a testnet corridor
  are confirmed.
- **SaaS subscriptions, hardware, emergency/runway funds, liquidity, reserves, or operational
  expenses.**

### 4.2 Deliverable-Aligned Budget Request

| Requested Budget Amount | Rationale for Budget Request                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| $5,000                  | $3,843.75 for development (At $31.25 per hour, 6 hours per day for 20.5 days comes to 123 hours).<br><br>$1,156.25 for QQA testing (At $31.25 per hour, 6 hours per day for 6.17 days comes to 37 hours). |

## 5. 30-Day Execution Plan & Timeline

### 5.1 Weekly Breakdown

| Week   | Planned Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Expected Output                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Week 1 | • Update swapper contract with Soroswap router call, slippage, and `execute_step`.<br>• Fix `validate.ts` `TemplateKind` inference and `scval.ts` serialization.<br>• Unhide swapper block in palette; build Swapper config panel (`asset_in`, `asset_out`, `slippage_bps`, router selector, deadline).<br>• Update `validateFlow` for swapper DAG rules.<br>• Add swapper event parsing and live-event classification.<br>• Manual testnet deploy + happy-path trigger to produce the Soroswap swap tx hash.<br>• Swapper simulation preview. | • Swapper block selectable/configurable in visual builder.<br>• One manual testnet swapper flow deployed and triggered.<br>• Soroswap swap tx hash visible on stellar.expert.<br>• Edge-case validation errors display clearly in UI. |
| Week 2 | • Extract reusable auth, basic rate-limiting, and audit primitives from payroll endpoints into a shared `/api/v1` middleware.<br>• Implement deployment-scoped API tokens.<br>• Build `POST /api/v1/deployments/[id]/execute` for the Swapper action.<br>• Build `GET /api/v1/deployments/[id]/events`.<br>• Add unit/integration tests.<br>• Generate initial OpenAPI spec and Postman collection.<br>• Write initial API documentation with curl examples.                                                                                   | • Authenticated curl requests execute a Swapper flow on testnet.<br>• Event polling endpoint returns on-chain events.<br>• Endpoint tests green in CI.<br>• Postman collection and API docs committed to repo.                        |
| Week 3 | • Design shared input components (`AssetSelect`, `AmountInput`, `AddressPicker`, `ShareInput`).<br>• Adopt them in the Swapper config panel.<br>• Unify Zod validation for the Swapper flow.<br>• Add component tests and UX pass.<br>• Accessibility and mobile viewport pass.                                                                                                                                                                                                                                                                | • Swapper config panel uses shared input primitives.<br>• Validation errors display consistently in the Swapper panel.<br>• Shared inputs pass smoke tests.<br>• UI tests green in CI.                                                |
| Week 4 | • End-to-end integration test with external wallet.<br>• Record and publish 3–5 min technical demo video.<br>• Write integration guide with curl examples and sample XDR payloads.<br>• Compile all on-chain receipt tx hashes.<br>• Final CI/typecheck pass.<br>• Prepare evidence handoff for the Ambassador Chapter Lead.                                                                                                                                                                                                                   | • Public demo video URL + usage guide URL + tx hash list on Stellar Expert (Testnet).<br>• Evidence package submitted with contract addresses, tx hashes, API docs, and screen recording.                                             |

## 6. Evidence of Completion (Required)

_Important guidance: Evidence should be clear, verifiable, and easy to review by the Ambassador
Chapter Lead with minimal technical expertise._

### 6.1 Planned Evidence to Be Submitted

| Deliverable        | Evidence Type (link, repo, demo, screenshot, doc, tx hash, etc.)                      | Description                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliverable 1      | Live app URL + screen recording + Stellar Expert tx hash + WASM hash                  | Public testnet URL showing the Swapper block in the builder; screen recording of deploy + trigger; tx hash of a swap executed through the Soroswap router on stellar.expert; contract WASM hash visible on testnet.             |
| Deliverable 2      | Public API URL + OpenAPI spec/Postman Collection + curl samples + audit log + tx hash | Public URL where the API is active; importable Postman collection or OpenAPI spec with example request/response for executing a swapper flow on testnet; sample audit log entry; on-chain tx hash from an API-triggered swap.   |
| Deliverable 3      | Live app URL + screen recording + before-and-after UI screenshots + CI test report    | Side-by-side Swapper config panel showing shared input primitives; screen recording of building a Swapper flow with the new inputs; CI test report for shared components; before-and-after UI screenshots of the Swapper panel. |
| Validation Package | Video + guide + tx list                                                               | Demo video (technical walkthrough). Usage guide. Tx hash list for all settlements on Stellar Expert.                                                                                                                            |

### 6.2 Evidence Verification Checklist (For Ambassador Use)

For each deliverable, the Ambassador Chapter Lead will assess whether evidence is present and
sufficient.

| Deliverable   | Evidence Present | Evidence Partial | Evidence Missing | Comments |
| ------------- | ---------------- | ---------------- | ---------------- | -------- |
| Deliverable 1 | ☐                | ☐                | ☐                |          |
| Deliverable 2 | ☐                | ☐                | ☐                |          |
| Deliverable 3 | ☐                | ☐                | ☐                |          |
| Deliverable 4 | ☐                | ☐                | ☐                |          |

### 6.3 Success Metrics

| Metric                                   | Target |
| ---------------------------------------- | ------ |
| Unique flows deployed                    | ≥ 5    |
| Contracts executions/events published    | ≥ 60   |
| Unique swapper flows executed on testnet | ≥ 5    |
| Contract WASM uploaded                   | ≥ 1    |
| Public testnet URL live & accessible     | Yes    |
| Demo video published                     | Yes    |

## 7. Next-Step Alignment

### 7.1 Anticipated Next Step After Completion

After this Instaward, the most likely next step is:

- ☐ Apply to SCF Build Award
- ☐ Continue development independently
- ☑ Apply for a follow-on Instaward (if eligible)
- ☑ Seek other ecosystem support
- ☐ Other:

## 8. Instawards Constraints Acknowledgement

By submitting this SOW, the Builder acknowledges:

- ☑ This scope will be completed within 30 days or less.
- ☑ Instawards support execution, not open-ended exploration.
- ☑ A project may receive no more than two follow-on Instawards.
- ☑ Each Instaward is capped at $5,000.
- ☑ Total Instawards funding may not exceed $15,000.

## 9. Submission Confirmation

Once finalized, this Statement of Work will be submitted by the Ambassador Chapter Lead via the
Instawards Airtable submission form for review and approval.
