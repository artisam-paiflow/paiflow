# Stored-mutation financial safety and rollout readiness

[#1171](https://github.com/webnxt-2030/pinkraft/issues/1171) remains **open**.
The evidence below is local source acceptance for the guarded immediate path,
not artifact activation, live network acceptance or a phase release. No WASM was
uploaded to a network, registry/environment synchronized, service deployed,
wallet funded or live transaction submitted for this work.

Release order is **execution parameters → isolated instances → stored mutation**.
[#1163](https://github.com/webnxt-2030/pinkraft/issues/1163) still requires its live
release acceptance. The [instance gate](instance-readiness.md) remains open under
#1167. Multisig is now explicitly excluded from this release, with new-use server
guards; its independently reproduced constructor/forwarding defects remain deferred.
The earlier gates still require live acceptance of enabled flow types.
Stored-mutation activation cannot pass those earlier release gates by implication.

## Cross-layer evidence

`tests/fixtures/mutation-acceptance.ts` uses the production graph compiler,
constructor encoder, `mutationV1Args` and payment encoder to produce the unsigned
ScVal packets in `tests/fixtures/mutation-acceptance/`. The inputs contain public
deterministic test identities, exact integer amounts, immutable policies and pinned
WASM hashes. They are not signed network envelopes or deployed fixtures.

The Rust runner consumes the same constructor and call bytes unchanged, first as
native contracts and then as freshly compiled WASM registered in a local test Env.
It checks each locally loaded WASM hash against the packet's pinned guarded
generation. The mutation is authorized using an exact source-account tree for the
root and every changed child; no authorization and missing-child authorization
both fail. Payment/setup operations use authorization mocks, with native payer
assertions. The guest debug-auth observation hook is disabled to avoid the SDK's
separate shadow-budget limit; source authorization itself remains enforced.

| Case                                                             | Actual local result                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grouped Pay + percentage Split update                            | Both nodes advance once; new current values and two `config_v1` events agree; original field policy/initial roster remain intact                      |
| Invalid grouped constant-row override                            | Root refuses; all getter bytes, revisions and balances equal their original observations                                                              |
| Legacy deposit, prefunded forwarding, cancel and routing setters | Every policy instance returns its explicit unsupported-path error; all getter/balance bytes remain unchanged                                          |
| Fixed Split accepts 50 toward a 100 batch                        | Whole-path mutation refuses, including an upstream-only Pay change                                                                                    |
| Pause/unpause with accepted debt                                 | Pausing neither clears the obligation nor permits an update                                                                                           |
| Accepted funds are removed so raw holdings are zero              | Accounted obligation remains 50; the same updates still refuse; neither revision changes                                                              |
| Operator repair followed by original-term settlement             | Repair alone does not clear debt; settlement discharges it without relabelling recipients or terms                                                    |
| Unsolicited 77 on each participating node                        | Mutation moves none; the subsequent payment preserves all three unrelated balances                                                                    |
| Old payment packet after update                                  | Rejects before payer balance changes; a fresh-revision packet using the same nonce succeeds, proving the stale call consumed neither funds nor nonce  |
| New payment after update                                         | Exactly 120 leaves its payer: constant platform receives 15 and the changed recipient receives 105; the old worker receives nothing from this payment |

The runner exports actual `current_config`, `capabilities`, `mutation_status` and
`config_v1` ScVals. Each observation is bound to the exact original packet bytes,
its SHA-256, the testnet identity/asset, node addresses and locally loaded WASM
hashes. The exact authorization entry accepted by the runner is retained with the
unsigned evidence. The [machine-readable report](evidence/2026-11-01-mutation-readiness.json)
records the runtime contract source and locked toolchain/SDK, not a network rollout.

The default Node tests regenerate the production packets and validate the recorded
guest observation bindings. A real PostgreSQL scratch-database test replays those
actual getter/event bytes through the production owner-scoped bearer routes,
SDK request/response parsers, external-signing callback, exact intent admission,
single submission, reconciliation, event poller and history projection. Only RPC
account/simulation/send/ledger transport is synthetic. The prepared mutation's
arguments and nested source authorization entry match the guest-accepted bytes.

The bridge also publishes a private immutable template, prepares and developer-signs
an actual instance factory envelope, and confirms its synthetic RPC result. Every
constructor argument is compared with the guest packet, relocating only synthetic
contract addresses to the preparation's salt-derived addresses. The resulting
instance then follows the same mutation API/SDK path. Its template version,
creation bindings, graph, compiler parameters, pipeline and original unsigned
factory envelope remain unchanged. A creation-time constant does not become a
runtime setter permission.

Direct external admin updates are ingested through the actual event poller and
configuration projection without fabricating an application signing record.
Current reads use verified getters, never retained history as a substitute for a
failed current read. History remains `observed-revisions-only`, reports missing
revisions and keeps its original observations distinct from event ledgers. A
getter/history comparison is not evidence that unobserved older revisions exist
in retained storage.

## Integrated owner review and safe refusal recovery

The bridge includes the merged #1170 implementation from develop
`aaed568fd635b0db069aabde811230b5b9373eb6`. The new DOM cases feed actual guest
getter/event observations through the production decoders and editor schemas;
their presentation payload is also compared with the real API/SDK reader response.
They show the changed recipient/current revision and explicitly incomplete history,
retain the labelled initial snapshot, hide unverified current values on a read
failure, and block editing/preparation on the guest's actual 50-stroop obligation
even though every participating raw balance is zero. Transport remains synthetic;
this is not live browser/device or wallet-extension acceptance.

The real PostgreSQL/API/SDK bridge also exercises the durable non-admission protocol
from [owner configuration](owner-configuration.md#safe-recovery-after-a-preparation-refusal):

- An actual guest-derived obligation refusal retains an immutable original-key
  `NOT_ADMITTED` receipt. The production browser proof verifier accepts that real
  response only with its matching request/deployment/network/admin/key digest.
- Previously simulated mutation and payment envelopes cannot admit later under
  that refused shared key. Both creators check the fence under the deployment lock.
- A fresh authenticated replay proves the same refusal after current obligations
  change. Only then can a freshly reviewed request use a new key.
- Once an intent has been admitted and submission loses its response, its original
  hash/work remains pending. Another key does not create an intent or receive a
  non-admission proof. No refusal erases an admitted or uncertain financial operation.

The implementation's existing signed-wallet, reload, cross-tab and refusal-race
tests remain in their owning #1170 suite; this bridge adds actual contract-observation
interoperability rather than claiming those mocked-wallet tests are live signing.

## Compatibility boundary

The [guarded mutation contract](mutation-v1.md) and [configuration API](api/configuration.md)
remain the source of truth. Mutation supports only a verified conserved immediate
Receive → Pay chain → terminal Pay/Split path. Every participating node must use
the reviewed guarded generation. There is no Schedule, subscription, condition,
prefunded or delayed setter; no delegated editor, routing/asset/admin switch,
permanent unlock, mode change, upgrade or existing-deployment retrofit.

Modes, configured row identity/order, payout/allocation kind and constants remain
fixed. Mutable initial appended rosters must be complete at deployment. Updates
are partial changes to explicitly mutable fields; full resulting groups are
validated. Do not replace obligation accounting with a token balance read.

| Deployment/definition                                           | Retained behavior                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Mode-less historical graph                                      | Existing ordinary contract semantics; no v1 execution or mutation capability inferred                                                   |
| Retained execution-only root/Pay/Split generation               | Existing execution discovery and exact payment flow stay supported; mutation stays false                                                |
| Guarded graph with a missing/old/unknown participating artifact | Mutation fails closed; metadata flags cannot confer authority                                                                           |
| New guarded deployment with declared mutable fields             | Current verified values/revisions and whole-path obligations govern admin-authorized updates                                            |
| Private immutable template version/instance                     | Creation bindings do not add runtime permissions; publication/retirement/cutover never rewrite an existing instance or pending envelope |

The existing execution acceptance suite exercises both retained artifact families;
the new bridge separately rejects execution-only and mode-less mutation attempts.
Strict older SDK versions may reject discovery for **new** mutation-capable
artifacts. Release an appropriate compatible SDK before offering those deployments
to machine consumers. Source SDK support and tests do not publish a package or
establish that a hosted backend is running it.

## Local resources and practical limits

The three-node grouped calls below ran with the local SDK's default functional
CPU/memory budget. Fixture construction and evidence serialization use an unlimited
harness budget and are excluded from these bounded invocation measurements.

| Packet                                | Instructions | Metered memory bytes | Written entries | Contract-event bytes |
| ------------------------------------- | -----------: | -------------------: | --------------: | -------------------: |
| Percentage grouped update             |    7,593,969 |            6,449,178 |               2 |                1,744 |
| Fixed grouped update after settlement |    7,579,073 |            6,446,370 |               2 |                1,756 |

These are local host observations, not fees, live protocol-29 simulation, maximum-
path qualification, throughput, wallet capability or a guarantee for another
payload. The test token is synthetic, not SAC. The SDK v26 cost model/budgets and
the [previously observed network settings](evidence/2026-11-01-stellar-network-settings.json)
are distinct. Re-read the target network settings and simulate each exact payload
at an authorized release. Forty nodes and twenty combined Split recipients are
structural ceilings, not promises that every layout fits the network.

Preparation's assembled `feeStroops` is reviewed with its exact unsigned envelope.
It includes its resource-fee bid, not a guaranteed net charge or price quote for
another update. No live fee/rent quote was obtained here. Current stored/history
snapshots, all artifact pins, intent identity and unresolved outcomes must survive
any resource or RPC failure; a timeout is never an automatic replacement signal.

## Activation and rollback plan — not performed

1. Complete the earlier execution and instance gates for enabled flow types,
   retaining the Multisig exclusion. Obtain explicitly authorized live signing,
   independent balance/allowance evidence where applicable, recovery and device
   evidence. Keep parent trackers open.
2. Select the reviewed app/API/SDK source and exact contract artifacts. First
   execution-phase activation still selects the retained execution-only artifacts
   from source `a60944c0551a9e1122b9f0ffca0e6a900169b733`, as specified by
   [execution readiness](execution-readiness.md). The default current-source build
   producing guarded mutation WASM does not authorize selecting it early.
3. For a separately authorized mutation rehearsal, rebuild the guarded root/Pay/Split
   with locked dependencies and the supported Rust toolchain; verify all three hashes
   against `MUTATION_V1_WASM_HASHES` and the committed report. Review ABI/spec,
   constructor, authorization and resource evidence together. Unknown or mixed
   generations remain refused.
4. Obtain explicit target-network/registry/hosted rollout authorization. Follow
   [the canonical pinned-network model](../CLAUDE.md#75-networks) and existing
   operations runbooks. Uploading bytes alone does not synchronize DB registry rows.
   Publish a new private template version after a reviewed artifact cutover; never
   repin an admitted version or pending preparation.
5. Apply the app's retained migrations, deploy the compatible reader/API/UI and SDK,
   and verify real current-config/history/event convergence before enabling new
   mutable deployments through the authorized artifact registry cutover. Existing
   deployments retain their original modes/artifact snapshots; no automatic migration
   or guided replacement is included.
6. Rehearse exact authorized admin signing, stale-payment rejection, competing
   payments/updates, zero-balance obligations, partial-group failure, unsolicited
   funds, direct external updates, unknown finality, access removal and retirement.
   Record actual app/SDK/artifact revisions, network, ledgers, fees and independent
   state/balance evidence. Do not infer success from PENDING or event absence.
7. On a failed rollout, stop further promotion and new mutation admission through
   the authorized operational rollback. Retain the compatible readers, both trusted
   artifact manifests, current/history evidence and unresolved work. A reviewed
   registry rollback may affect future preparations only; it cannot rewrite existing
   snapshots or return a contract's revision/modes to earlier values. Never downgrade
   to a reader that cannot serve already-deployed guarded contracts, clear pending
   work by timeout, delete refusals or discard retention gaps. Use the existing
   production kill-switch/runbook when an authorized emergency stop is required.

## Reproduce the local bridge

Use supported Node/pnpm/Rust versions, a dedicated loopback PostgreSQL test URL,
and synthetic local auth configuration. Production imports validate ordinary
configuration even when a generator performs no network I/O.

```sh
pnpm db:generate
node --conditions=react-server --import tsx scripts/generate-mutation-acceptance.ts
cd contracts
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-splitter
cargo test --locked -p payer --test mutation-acceptance
cargo test --locked -p payer --test mutation-acceptance -- --ignored --nocapture > /tmp/mutation-guest.log
cd ..
node --conditions=react-server --import tsx scripts/generate-mutation-acceptance.ts --observations-log=/tmp/mutation-guest.log --contract-source=98221d2e862e6b2551adb79f0e7928a3bd4cb67e
pnpm test tests/unit/mutations/acceptance-packets.test.ts tests/unit/mutations/cross-layer-acceptance.test.ts tests/unit/mutations/guest-editor-acceptance.test.tsx
```

Default Node tests use committed guest observations and do not require untracked
WASM builds. Default Rust runs the native packet case and explicitly ignores the
guest case until the three WASMs are built. The guest invocation above is required
to reproduce its actual result; a default ignored count is not guest acceptance.
No command above uploads artifacts or contacts a public ledger.
