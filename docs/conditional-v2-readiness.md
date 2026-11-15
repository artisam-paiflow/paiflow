# Conditional source readiness and rollout

[#1229](https://github.com/webnxt-2030/pinkraft/issues/1229) joins production packets,
compiled contracts, API/SDK/owner/hosted review, financial history and original
recovery. This is a source/local evidence gate. Artifact upload/activation, SDK
publication, hosted deployment and funded genuine-wallet/device acceptance require
separate authorization and their own evidence. Keep #1163/#1167/#1171, #1003/#937
and remaining security/device trackers distinct; none closes by implication.

## Artifact coexistence

Legacy `ContractTemplate` has one row per kind/network. Conditional Receive, Pay,
Split and Router binaries have distinct reviewed hashes. Replacing the old slots
would disrupt v1 availability and template publication fingerprints. The new
`ConditionalArtifactSet` stores a separate network/version2 configuration, all four
exact approved pins, default-disabled enablement and timestamps. Migration87 creates
an **empty** table. It does not activate anything, copy registry data, rewrite
instances or change initial/financial evidence.

Legacy readers, environment fallback, v1 trusted lists and published template pins
retain their formats. Conditional preparation reads only the separate set, without
old-row/env fallback or process-lifetime cache. Missing/disabled configuration is
unavailable for fresh preparation. Source allowlists validate every family; parser,
configuration or artifact presence alone never grants supported runtime capability.
The existing full instance/getter/executable fences and exact simulation remain
mandatory. Only participating families are required on a concrete deployment path.

The existing deployment review engine stays mounted for a strict conditional draft
even when its current graph is incomplete or fresh artifacts unavailable. Fresh
preparation is disabled; original keyed retry/review/signing/submission/reconciliation
keeps its original evidence. Existing trusted-factory rotation checks remain.
Disabling this configuration stops new deployment admission; it does not revoke
existing execution, mutation, hosted receipts or postclaim original-hash recovery.
No template controls, formats, automatic retrofit or new signer/sender are added.

The configuration command defaults to read-only planning:

```sh
pnpm contracts:conditional:config
pnpm contracts:conditional:config --disable
```

Use the target service's explicit environment; network follows
[CLAUDE.md §7.5](../CLAUDE.md#75-networks). A plan contains only public configuration,
before/after digests and the explicit network/version. It performs no upload,
network call, signature, legacy registry/env write or activation. A separately
reviewed and authorized application requires the expected **current** digest:

```sh
pnpm contracts:conditional:config --apply --expect <reviewed-current-digest>
pnpm contracts:conditional:config --disable --apply --expect <reviewed-current-digest>
```

Application serializes the network/version, compares the expected digest inside
its transaction, changes only the conditional row and writes a nullable-actor
operator audit with public before/after identities. A stale plan refuses. Do not
infer that a source test or example command authorizes applying live configuration.

## Separately authorized activation sequence

1. Freeze the final source, binary/ABI hashes, compatibility/evidence report and
   reviewed PR head. Required hosted CI must correspond to that exact published head.
   Keep source completion, issue acceptance and actual release acceptance separate.
2. Verify the environment/network, RPC settings, factory code/address/ABI, contract
   TTLs, actual network resource limits and all retained legacy/template registry
   fingerprints. Preserve initial snapshots, original admissions and financial history.
3. Apply migrations before starting the new application. An empty conditional set
   leaves fresh conditional preparation unavailable. Deploy an application able to
   reconcile all admitted v1/v2 originals and ingest both event generations before
   making new v2 traffic available. Do not alter ordinary scheduler operation.
4. After explicit upload authorization, upload only the exact reviewed conditional
   bytes without legacy registry/env synchronization. The installed CLI's
   `stellar contract upload --wasm <reviewed-file> --source-account <approved-alias>
--network <environment-alias>` is an upload-only operation; this runbook does
   not execute it. Verify returned hashes and RPC code/TTL evidence for each needed
   family. Any optimization/rebuild or byte change requires renewed artifact review.
   Keep the factory unchanged unless independently qualified/authorized.
5. **Do not use** the ordinary `contracts:deploy`, `contracts:upload` or normal
   `contracts:update-hashes` workflow for conditional binaries: those workflows
   synchronize legacy slots. The new preflight rejects known conditional hashes and actual conditional ABI
   spec entries (including unknown rebuilt hashes) before side effects; the conditional configuration command never calls them.
6. Obtain a dry-run configuration plan, independently review its exact network,
   four pins and expected-current digest, then apply only under the separate
   configuration authorization. Verify legacy rows/template fingerprints unchanged.
7. Run actual network fee/resource simulations and bounded genuine wallet/browser/
   handset acceptance: both comparisons/equality, prefix effects, all terminal kinds,
   strict selected inputs, owner!=payer, inactive revision and debt races, exact
   accounting, original recovery and ordinary operational observations. Keep fees,
   attempted commitments and final debits separate. No local/mocked result completes
   this gate. SDK publication and hosted deployment need their own authorization.

No step is performed by writing this document. Record each actually performed
artifact/network/hosted/wallet gate independently; unperformed gates remain open.

## Rollback and preservation

A reviewed `--disable` plan/apply stops **fresh conditional deployment preparation**
without changing legacy registry slots or erasing the separate configuration/audit.
Owner hosted opt-out controls new public payments independently. Keep every admitted
original key, unsigned identity, exact hash, signer and stage. Reconciliation after
claim uses the original transaction even if current configuration or RPC history
changes. Missing rows, timeout, raw-zero balance or expiry alone never authorizes
replacement or financial evidence cleanup.

Do not roll the application back to software unable to recover admitted v2 originals
or decode their events/history. Retain enforcing contract binaries/TTL and the
source path needed for those obligations. Registry/frontend rollback does not undo
on-chain transactions. Preserve current observations, out-of-order/replayed events,
known gaps and initial immutable construction evidence. Never repin templates or
reopen constants as rollback.

## Reproducible local evidence

The local harness captures actual `deploy_pipeline` arguments from the existing
production deployment builder, including exact salts, source, compiled initial
manifest and full graph order. It does not create a second blueprint/constructor
codec. Execution/mutation arguments use the production codecs/services. Actual
compiled factory/family bytes and the test ledger network ID are bound to those
packets; source auth covers the factory and contract-creation calls explicitly.

Seven bounded layouts cover minimal strict-gt/lt, the five-node prefix/selected-Split
path,20-row allocation,8/12-node prefixes and the structural40-node probe. A measured
default-budget refusal is a refusal, with downstream stages not reached. It is not
turned into a success by registering children with unlimited budgets. Setup and
observation work is separate from actual measured calls. The existing54 guarded
execution vectors and grouped mutation evidence remain useful; they are not
recreated merely to increase counts.

The native asset fixture uses the actual built-in SAC where available, with explicit
synthetic ledger/account setup qualifications. Getter/status/manifest/initial and
instance/code XDR plus events are exported from the guest and joined to production
readers/decoders/history and the same public SDK/hosted review. Initial evidence is
compared unchanged; replay, gaps, stale pins and unknown original outcomes stay honest.
Token debit/credit/refund/conservation is separate from fee estimates.

Pinned SDK26 local defaults and meter/post-invocation fences differ; the actual
budget and any post-fence panic must be labeled separately. Its `fee()` model is a
hardcoded **2024-12-11** snapshot, not current network/RPC pricing. Measured local
instructions/memory/XDR/getter costs are not throughput, maximum-layout support,
current fees or wallet/device promises. The final sanitized measurement report and
exact input/output/bin/source identities accompany the reviewed candidate. Complete
candidate identity lives in the local handoff/manifest, avoiding a self-hash cycle.

## Recorded local measurement gate

The [sanitized measurement report](testing/conditional-v2-readiness/measurement-report.json)
binds the final production-generated packets, compiled outputs and exact source/binary
identities. Under the unchanged local SDK26 main budget of100,000,000 CPU instructions
and41,943,040 memory bytes, both four-node minimal conditions, the five-node standard
layout and the eight-node prefix probe deploy successfully. Twenty-recipient,
twelve-node prefix and forty-node probes refuse at the actual CPU budget; their
payment/current-review stages are **not reached**. Structural validation limits do
not promise those layouts are deployable on a particular network.

The joined run verifies12 successful payments, one successful grouped update and
one unused-nonce stale-revision refusal (contract105), with exact native-SAC balance
changes, zero mutation/refusal transfers and15 projected route/configuration events.
It feeds actual guest getters/instance entries into the production fenced reader,
current DTO, event decoder and PostgreSQL history, then SDK parsers/sign-only callback
and hosted financial review. These are local transport fixtures; they are not actual
HTTP, live RPC, wallet-extension or funded network acceptance.

One complete fenced read per observed phase measures16/20/32 getter simulations for
four/five/eight nodes, two instance RPC requests and one separately mocked account
loader call. Its underlying account RPC is **not measured**. Exact public JSON body
sizes are3732 bytes for minimal,5682→5680 for standard and8563 for eight nodes,
excluding HTTP headers/compression. The report also records packet, unsigned deployment
and full getter/instance-sidecar sizes; sidecar sizes cover whole layout histories.
No local RPC count establishes network latency or throughput.

The SDK debug shadow meter required bounded1-billion CPU/512-MiB reporting headroom.
The actual measured budget remains100-million/40-MiB, and an independent default-shadow
control produces identical outcomes, balances, states, events and sidecar bytes for
all seven layouts. Successful eight-node calls expose diagnostic memory counters
about3KB above the configured memory limit; preserve those raw observations without
inferring network fit or silently changing the limit. Even then, successful eight-node operations report zero diagnostic
write/event counters despite actual changes. **All fee diagnostics remain incomplete,
historical model-only and unusable as quotes.** Large first-native-payment rent values
reflect synthetic fixture/model assumptions. Never convert them to XLM or sum them as
actual fees. The native-SAC fixture uses synthetic classic balances1,000,000,000 stroops
and base reserve0; setup warms stored-code/module caches, and observation budgets are
separate. Live fees, rent, resource limits and cold execution require fresh network
simulation before release.

All four approved guarded binaries were reproduced byte-for-byte with Rust/Cargo1.95.0,
`--locked --offline --release --target wasm32v1-none`, the original canonical
`CARGO_HOME=/var/tmp/paiflow-1224-ci/cargo-home` and an empty target directory. A different
CargoHome embeds two different SDK source-path data bytes per module while leaving code
sections equal. This is a documented path-sensitive recipe, not arbitrary-path binary
reproducibility, and grants no new trusted hash. The measurement report binds the
canonical build receipt and unchanged approved hashes.

To reproduce the opt-in joined test, first create and verify a task-owned loopback
scratch PostgreSQL database, apply migrations, use the repository's pinned Node/pnpm
and Rust toolchains, and compile the factory plus the four approved guarded family
bytes. Verify every byte hash against the artifact report before execution. With
`NODE_ENV=test`, isolated `DATABASE_URL` and a **new** persistent output path:

```sh
PAIFLOW_CONDITIONAL_JOIN_DIRECTORY=<new-task-owned-directory> \
PAIFLOW_CONDITIONAL_WASM_DIRECTORY=<verified-five-wasm-directory> \
PAIFLOW_CONDITIONAL_CARGO_TARGET_DIRECTORY=<task-owned-cargo-target> \
pnpm test tests/unit/acceptance/conditional-v2-joined.test.ts --maxWorkers=1
```

The current test additionally pins its owned fixture to `127.0.0.1:34263/paiflow_1229_join`
and its Rust dependency cache to `/var/tmp/paiflow-1228-ci/cargo-home`. Provision those
locations only after confirming ownership and vacancy, or review an explicit test-only
path adaptation before running elsewhere. Never redirect it to existing shared storage.
The in-process fixture retains ephemeral signers in memory and invokes the explicitly
ignored compiled factory harness. It refuses output reuse. These test-only environment
variables are not application configuration. The packet-producer test has its own
opt-in `PAIFLOW_CONDITIONAL_PACKET_DIRECTORY`; normal CI explicitly skips both heavy
opt-ins, so their separate executed receipts must accompany an acceptance claim.

## Acceptance coverage and open release gates

| Requirement                                                                                              | Local evidence                                                                                                                    | Release disposition                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Strict comparisons/equality, post-prefix amount, terminal combinations, i128 boundaries, selected inputs | Existing54 compiled execution vectors plus the joined minimal/standard/native-SAC packets                                         | Source/local exercised; network matrix remains open         |
| Funding, refunds, rounding, accumulation, unsolicited funds, cross-payer isolation and late rollback     | Retained contract/accounting suites and compiled execution/mutation evidence                                                      | Preserve exact prior receipts; no new live claim            |
| Whole-graph mutation, inactive revision/debt, constants, direct auth and bypass refusal                  | Existing grouped mutation/adversarial suites plus fresh joined update/stale105                                                    | Local source evidence; live race/settlement acceptance open |
| API/SDK/owner/hosted exact originals, signing/refusal/storage/expiry/retirement cases                    | Focused integration/component suites and full local CI; actual guest current/history/SDK join                                     | Genuine browser/device/network interruption matrix open     |
| History replay/gaps/private contacts/immutable initial evidence                                          | Actual guest events/getters through reader and PostgreSQL projector; retained history suites                                      | Network retention and operational observation open          |
| Legacy generations, pending originals and template pins                                                  | Separate disabled-by-default registry, writer preflight, retained regression suites and isolated PostgreSQL coexistence/CAS tests | No automatic retrofit, template change or pin activation    |
| Resources and all-node review costs                                                                      | Seven-layout report, recorded default refusals, exact DTO/call/XDR costs                                                          | Current RPC fees/resource/cold-path qualification open      |

The selected-candidate full local CI and independent review receipts live in the
unpublished handoff alongside complete new-file manifests. Hosted CI is **not run**
until an authorized PR exists. Upload/activation, SDK publication, hosted deployment,
genuine signatures/wallets/devices and funded accounting remain unchecked. Required
predecessor/security/recovery/device trackers remain independently open. Completing
local source work does not close the epic or grant release approval.
