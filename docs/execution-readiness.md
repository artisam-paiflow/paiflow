# Execution-parameter acceptance and activation plan

Source acceptance for [#1163](https://github.com/webnxt-2030/pinkraft/issues/1163),
integrating #1158–#1162. This is **not an activation or live-wallet acceptance
record**. No artifact upload, registry change, hosted service deployment, funded
transaction or mainnet write was performed. Execution, instances and mutation
remain separate phases; #848/#1155 must not close merely because source PRs merge.

## What the local acceptance actually connects

`tests/fixtures/execution-acceptance.ts` defines public synthetic business cases.
The production graph compiler, constructor encoder and `executionV1Args` generate
committed **unsigned ScVal** vectors under `tests/fixtures/execution-acceptance/`.
The TypeScript acceptance test checks the committed bytes against those encoders;
the Rust acceptance runner consumes those same bytes unchanged for construction
and calls. No signed envelope, private key, API credential or live fixture is in
these vector files.

| Case                                | Reviewed constants                                        | Per-payment differences                                                               | Verified outcome                                                    |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Senda-like variable Pay             | 15% Pay to the same platform; terminal full-amount payout | Two payer wallets and two beneficiary addresses                                       | 200 → 30/170; 100 → 15/85 through the same root/Pay/Pay contracts   |
| Bayanihan-like percentage roster    | Same platform address and 1,500 bps configured row        | Different payers, worker lists and allocations; a later payment by the original payer | 101 → 15/30/56, 200 → 30/170, 100 → 15/85; last row gets rounding   |
| Remittance-style exact fixed roster | Same 15-stroop platform fee; fixed mode                   | Worker membership/amounts and incoming amount                                         | 100 → 15/35/50; 115 → 15/100; 99/101 for a 100-stroop roster reject |

These are representative integration fixtures, not claims that external apps were
deployed or tested. A fixed 15-stroop fee is intentionally distinct from a 15%
share. Both constant recipients and the selected allocation rule remain immutable.

`tests/unit/execution-acceptance.test.ts` exercises real Postgres, bearer-token
authentication and HTTP route wrappers, pinned executable/getter verification,
simulation/assembly, real in-memory wallet signatures, durable admission,
single-send submission and reconciliation. It also uses the actual hosted form
conversion/review functions and public ownership/prepare/submit/receipt routes.
Distinct payers prepare concurrently against one deployment; replayed submissions
send once; completed payments can reuse the same deployment with new inputs.
Original graph/snapshot evidence stays unchanged and private contact/token data
does not enter the public state response.

Cross-layer recovery found and fixes an early-failure gap: if the first simulation
failed before admission, a restored `preparing` browser had no intent and could
not recover without another ownership proof. Recovery may now re-prove only the
same immutable request/key while retaining its non-editable `preparing` state.
Database/component tests cover an original simulation committing during that
proof dialog and verify one intent/hash. Known receipts and uncertain actual
payment signatures remain conservative; no editing, cancellation, new payment
identity, automatic payment signing or blind resend is introduced.
The confirmed Receive minimum and ordinary input/group validation run before a
new browser record/proof is created. Already-dispatched permanently invalid or
resource-infeasible requests retain uncertainty and may need operator assistance;
the same-key retry is not a general cancellation or input-editing protocol.

The RPC transport is synthetic: getter responses reflect the compiled constructor
ScVals, simulation supplies synthetic resource data, and submission does not leave
the process. Telemetry delivery and the unused owner-session import are stubbed;
deployment bearer authentication, validation and financial persistence are not.
This is **not** a real RPC, factory deployment, browser-extension or device test.
The raw-contract runner separately verifies actual token balances using those
constructor/call bytes against native contracts and the reviewed compiled WASMs.

Missing/unknown inputs, configured-platform overrides, fixed funding deficit/excess,
the 21st combined recipient and stale revisions reject across the relevant raw,
API and hosted surfaces. Raw nonce replay rejects; API retries instead retain the
original durable hash/intent. API/hosted synthetic revision drift is rejected
before send; raw revision mismatch rejects before funds move. Actual stored
mutation and direct-update reconciliation remain their later workstream.

## Artifacts, resources and structural bounds

The retained execution-only generation was rebuilt from execution-phase source
`a60944c0551a9e1122b9f0ffca0e6a900169b733` with Rust 1.95.0, locked dependencies and
the workspace release profile. `scripts/check-execution-artifacts.ts --execution-only`
reproduced these exact outputs, and their guest acceptance was rerun after the
guarded-source merge without replacing the preserved old WASM bytes:

| Kind            | SHA-256                                                            |  Bytes |
| --------------- | ------------------------------------------------------------------ | -----: |
| DEPOSIT_TRIGGER | `501864f26d6acfe1e2c6992caa585a5e7b1b40380b622ba3ba03df16b7a209a3` | 29,653 |
| PAYER           | `be042aff166c3295cba284600e8455409323491a4e0256524a575d342c5e103b` | 40,342 |
| SPLITTER        | `5b4303816afddb482e3a850ea9d461d6c5bce0e5ef9a92a5b4e5e9d5dc852f57` | 50,354 |

The subsequently merged guarded generation from #1168 (`ebe8692e`) was rebuilt
separately. The verifier's **default** now targets this generation, not the old
table above:

| Kind            | Guarded-generation SHA-256                                         |  Bytes |
| --------------- | ------------------------------------------------------------------ | -----: |
| DEPOSIT_TRIGGER | `2bd7fd8d6251092f49833513f50e3c04b9188f8da47a7cb73e5c84b521dc16ec` | 39,407 |
| PAYER           | `dcfc03ef0b4f608148313059c531e034ae43d3c2b6ae6149f9766e341c887318` | 50,918 |
| SPLITTER        | `589df78f21dfacceaefb59a2b66b019afb487090c3cd31beaf04d5f540768da9` | 65,926 |

The same unchanged execution packets pass against **both** guest generations, and
HTTP discovery/preparation tests retain the correct per-generation pinned hashes
and mutation capability. Old hashes stay execution-only. These newer builds are
compatibility evidence here; mutable activation still awaits its later phase and
separate authorization. See [mutation v1](mutation-v1.md) for its own contract scope.

The manifest is build/review evidence, not proof that any network has these WASMs
uploaded or the application registry configured. Factory kind-agnostic deployment
still needs its real simulation/atomic deployment acceptance after authorization.
Tagged constructor configurations preserve argument counts but **change ABI
semantics**; legacy hashes are never inferred to enforce the new policies.

Bounded local SDK v26 guest diagnostics for the committed fixtures measured:

| Execution                                           | Execution-only instructions / memory bytes | Guarded-generation instructions / memory bytes |
| --------------------------------------------------- | -----------------------------------------: | ---------------------------------------------: |
| Percentage roster, three destinations               |                      5,013,121 / 3,994,244 |                          5,222,573 / 4,022,859 |
| Fixed roster, three destinations                    |                      4,860,396 / 3,931,772 |                          5,069,848 / 3,960,387 |
| Two Pay hops, constant 15% and variable beneficiary |                      5,801,509 / 6,434,099 |                          5,947,370 / 6,456,451 |
| Percentage roster, **20 combined destinations**     |                     18,692,895 / 4,614,809 |                         18,902,347 / 4,643,424 |

See [execution-v1.md](execution-v1.md#local-verification-and-resource-evidence)
for the same-outcome legacy/native/guest comparison. Native execution omits guest
VM costs, so its lower cost is not a network estimate. These fixtures also keep
99 unsolicited stroops at every participating contract and verify that repeated
payments, rejection and resource failure leave those holdings untouched.

The SDK's debug auth-snapshot observer exceeds its separate shadow budget at the
20-recipient boundary. The native functional runner retains exact source-account
auth observation under an unlimited diagnostic budget. The **identical business-case guest
vectors** retain the default execution budget with only that observation hook
disabled. Auth credentials/checks remain real. IO footprints/fees are not inferred
from the observer-disabled diagnostic. Fixture construction is unmetered setup,
not a factory deployment-resource measurement.

**Forty nodes is a structural schema ceiling, not an executable-layout promise.**
The separate `structural-ceiling-40-nodes-20-recipients` vector has Receive → 38 Pay
hops → Split with 20 destinations. Its bounded guest invocation is refused at
`41,943,052 > 41,943,040` metered memory bytes on the execution-only generation.
The guarded-generation probe also refuses with a 400-million CPU/41,943,040-byte
budget using the local SDK cost model: it reaches 38,406,455 instructions and
41,946,356 budget memory bytes at refusal, not at successful completion.
The regression verifies rollback
of every payer, recipient and contract balance. It does not classify an arbitrary
contract error as resource refusal. The corresponding production API simulation
error returns 422 without an unsigned payment, reservation or send.

The 40-node unsigned **simulation request** is 9,912 bytes. That excludes an
assembled footprint, actual simulation authorization and wallet signatures; it
is not a complete network envelope-size or fee proof. Mandatory deployment and
execution simulation must reject layouts exceeding the selected network's limits
before asking for a payment signature. No automatic splitting/partial payment or
silent limit expansion is introduced.

Public read-only network configuration was captured at
`2026-11-01T10:05:02.563Z`–`10:05:03.631Z` in
[the exact RPC evidence](evidence/2026-11-01-stellar-network-settings.json).
Both TESTNET and MAINNET reported protocol 29, 400,000,000 transaction instructions,
41,943,040 memory bytes, 16,384 contract-event bytes, 132,096 transaction bytes and
131,072 contract-WASM bytes. The local SDK default 100-million CPU diagnostic is
stricter than that captured network CPU setting; the depth probe's observed memory
failure is a separate limit. SDK v26 cost parameters/host behavior and these dated
network settings still do not establish protocol-29 simulation suitability.

The evidence records `getNetwork`, `getVersionInfo`, and `getLedgerEntries` requests,
responses and UTC timestamps for [Stellar TESTNET RPC](https://soroban-testnet.stellar.org)
and [the MAINNET provider](https://soroban-rpc.mainnet.stellar.gateway.fm).
`tests/unit/stellar/network-settings-evidence.test.ts` decodes the actual XDR for
configuration keys 0/1/4/5 rather than trusting a prose summary. Re-query those
read-only methods and decode their response before any authorized rollout; network
settings can change. No simulation/signing/submission occurred during that capture.

## Compatibility and remaining security boundaries

- Mode-less legacy definitions/deployments keep their existing semantics and
  artifacts. A registry update is not an upgrade or migration of existing contracts.
  New policy-aware definitions fail closed with unavailable/unreviewed artifacts.
- Legacy Receive → Split pipeline deposits do **not** enforce a stored Splitter
  minimum: `deposit` forwards to `execute_step` → `execute_split`, whereas only the
  legacy direct `distribute` path checks that value. Do not advertise this as an
  enforced pipeline minimum. Template declarations reject every legacy minimum
  binding; a reviewed policy-aware Receive root enforces its minimum before pulls.
  This acceptance change does not alter legacy contracts.
- #550 remains open for disposition of the retained legacy submit work; the actual
  source-signature guard is present. #851 remains open for historical public submit
  integrity. Those legacy public routes refuse policy-v1, whose exact-intent flow
  is separately guarded. #937's source recovery safeguards are delivered, while
  its live/device acceptance remains open. This plan does not close those issues.
- Owner opt-in is default off and controls hosted visibility/new first-send
  admission, not direct on-chain callability. Receipt capabilities and durable
  unknown-finality records survive opt-out and retirement. Never clear a pending
  payer reservation or financial obligation merely because a deadline elapsed.
- Private immutable templates (#1164) are separate from execution input values;
  this work does not instantiate templates, activate mutable modes, restore Dev
  credentials or introduce backend-held payer keys.

## Authorized rollout sequence — not executed here

1. Obtain separate authorization for the exact environment, candidate commit,
   artifact activation and wallet acceptance. Follow the canonical
   [network model](../CLAUDE.md#75-networks), [release policy](releasing.md) and
   [operational cutover](mainnet-cutover.md). Do not take a wallet's runtime
   network as authority or introduce a per-deployment network picker.
2. Reproduce the locked builds, hashes, local acceptance and current network
   configuration. Save the candidate's previous registry/factory evidence and
   inventory existing deployment snapshots/unfinished intents for rollback.
3. For **execution-phase** activation, select the retained execution-only manifest
   and its matching source above. Do not upload the verifier's default guarded
   build as an accidental shortcut around the instances/mutation release order.
   Upload only the selected reviewed artifacts in the authorized network. Verify actual
   uploaded executable hashes, storage TTL/availability and ABI. Confirm the
   selected factory supports the atomic pipeline constructor vector; no factory
   change is implied merely by adding child policy payloads.
4. Synchronize the **target environment's database** `ContractTemplate` hashes/ABI
   and `FactoryDeployment` evidence using the maintained operational tooling.
   Uploading locally alone does not configure a deployed app. `contracts:update-hashes`
   has no `--network` switch and resolves its environment independently of the
   upload flag; verify the target environment/database before it runs.
5. Before enabling hosted opt-in, perform authorized real RPC simulation and a new
   wallet-signed factory deployment. Record ledger, exact child addresses,
   executable hashes, immutable policies, complete snapshot and actual deployment/
   storage/transaction costs. Verify failure is atomic, including a bad child.
6. Run the named varied-destination cases with authorized wallets: review constants,
   asset/network/fees, sign the unchanged prepared envelope, verify independent
   balances/events, replay/unknown-finality behavior and opt-out/retirement recovery.
   Include realistic boundary layouts and inspect real footprints/auth/event sizes;
   a passing small fixture does not qualify every structurally valid graph.
7. Enable hosted visibility only by the owning account's explicit audited opt-in.
   Record separate acceptance results by surface/wallet/device; source tests and
   test collection cannot substitute for browser-extension or funded acceptance.

If any gate fails, do not activate/enable new deployments. Preserve the exact
prepared hashes and evidence, diagnose and obtain review of the corrected commit.
Actual network simulation, factory deployment/costs, wallet/device and funded
acceptance remain **unperformed gates**; no unconditional release-readiness claim
is made here.

## Rollback and uncertainty

Restore reviewed registry/factory configuration for **future preparations** only;
existing on-chain contracts and snapshots are not rewritten, upgraded or replaced.
If restored artifacts cannot enforce policy-v1, keep new policy deployments
unavailable. Keep an application build that can read/reconcile already-admitted
policy intents and their pinned artifacts; rolling back to pre-policy code is not
a safe recovery plan for those deployments.

Disable new hosted work through owner opt-out where applicable while retaining
receipt/status recovery. On-chain transactions may still finalize and direct calls
remain governed by their contracts. Reconcile their original hash through durable
history; never resend a crashed/unknown transaction automatically, erase history,
change a reviewed recipient or clear an obligation by timeout. Follow retirement
and operational runbooks for service-level intervention; scaling service capacity
does not cancel a chain transaction.

## Reproduce local acceptance

Local integration checks after the #1168 source merge passed: 5,945 Node/component
tests (19 skipped), app typecheck, the Rust workspace (219 passed; eight manual
checks ignored), warning-denied Clippy, both artifact generations' focused guest
acceptance and resource-refusal probes, SDK packed-consumer checks (22 tests plus
typed examples), SDK reference consistency, audit, seed, production build and five
SSE shutdown scenarios. The exact candidate/review head and any later verification
are recorded in the implementation PR. The preservation script also passed all
40 cases and complete history/schema/shadow checks on the unchanged 80-migration
schema; no migration SQL changed in this integration.

App-image smoke and live browser/extension/device/funded acceptance were not run.
Existing build warnings remain: worktree-root inference, `jose` Edge Runtime
compression APIs and missing Next ESLint plugin. Those are not recorded as clean
lint/image/live acceptance.

Use the repository-supported Node/pnpm/Rust versions and isolated local Postgres/
Redis per [tests/CLAUDE.md](../tests/CLAUDE.md). Never point these tests at live data.

```sh
pnpm db:generate
pnpm db:migrate:deploy
pnpm test tests/unit/execution-acceptance.test.ts tests/unit/stellar/network-settings-evidence.test.ts
python3 tests/integration/payroll-cleanup-migration.py --port <scratch-port> --user <scratch-user>
cd contracts
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-splitter -j 1
cargo test --locked -p payer --test execution-acceptance
cargo test --locked -p payer --test execution-acceptance -- --ignored --nocapture
cd ..
node --import tsx scripts/check-execution-artifacts.ts
```

These commands use the current merged source and therefore build/verify the
guarded generation. To reproduce the retained execution-only table, build the
three WASMs in a separate clean checkout of
`a60944c0551a9e1122b9f0ffca0e6a900169b733`. Preserve the current output separately,
then place only those three old WASMs in this integration checkout's expected
`contracts/target/wasm32v1-none/release/` paths. Run the **current** verifier with
`--execution-only` and this checkout's guest acceptance harness. Restore/rebuild
the guarded outputs before its default verification. Preserve and identify both
sets separately; never label a new-generation profile with an old hash.

The preservation test now first exercises both historical restoration paths and
all 40 financial-preservation cases, then applies **every** subsequent migration
before current-schema comparison. It verifies the exact applied migration names,
unchanged historical checksum, refusal of unknown/partial histories, repeat deploy
and a complete Prisma shadow replay. No merged migration SQL is edited.

To deliberately regenerate vectors after a reviewed compiler/schema change, supply
synthetic TESTNET configuration (`AUTH_SECRET` and a dummy `DATABASE_URL`; no network
connection is made) and run
`node --conditions=react-server --import tsx scripts/generate-execution-acceptance.ts`.
Review the public source scenarios, byte diffs and both-language acceptance together.
