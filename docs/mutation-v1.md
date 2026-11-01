# Guarded stored configuration: contract and compiler v1

[#1168](https://github.com/webnxt-2030/pinkraft/issues/1168) implements the contract,
compiler, encoding and verified-read portion of stored Pay/Split updates. It is
not artifact activation or live acceptance. Mutation API preparation/recovery and
confirmed history are #1169; the deployed owner editor is #1170. The release order
remains execution, instances, then mutation. Existing deployments are not upgraded.
Network selection follows [CLAUDE.md §7.5](../CLAUDE.md#75-networks).

## Supported path and authorization

Guarded mutation supports the same conserved immediate path as
[execution v1](execution-v1.md): Receive → zero or more Pay → terminal Pay/Split,
one asset, one money edge per hop, no joins or branches. Delayed, prefunded,
scheduled, subscription, conditional, relayer and unknown/legacy paths are refused.
Those paths have no proven whole-path obligation admission protocol; this change
does not infer safety from their current balances or reduce normal constant-flow
support.

The root exposes `mutate_v1(bindings, changes)`. Ordered bindings identify the
**entire** immutable path, including the root at revision zero, with the reviewed
revision of each participating node. Each typed Pay/Split change also names its
expected revision. Unknown, duplicate, empty and irrelevant changes fail. Each
changed node must contain an actual value change and advances its revision exactly
once; revision overflow fails atomically. No previous configuration is retained as
an alternative execution target.

The stored admin must authorize the root call and each changed child invocation.
Children additionally require their immutable parent's authorization for the full
forwarded `MutationContext`. Unchanged forwarding nodes do not consume admin
update authority, but still enforce the parent, path and revision. The SDK/RPC
simulation must construct the actual authorization tree; a root signature without
the required changed-child authorizations fails. API credentials confer no on-chain
admin authority and Paiflow receives no developer private key. See Stellar's
[authorization model](https://stellar.org/blog/foundation-news/stellars-composable-auth-model).

## Valid initial values and immutable evidence

All modes, configured row identities/order, payout/allocation kind, asset, admin
and routing remain lifetime-fixed. Pay full amount is an immutable rule, not a
mutable percentage value. Partial updates can change only declared stored mutable
recipients, Pay fixed/percentage values, Split row allocations, and an explicitly
mutable appended roster. They cannot fill execution-only fields or override a
constant. Allocation modes cannot change. Final stored percentage allocations total
10,000 bps, fixed values are positive checked i128 amounts, known recipients are
unique, and the combined configured/appended roster has at most 20 rows. Execution
recipient slots remain absent until that payment supplies them; they are not saved
defaults.

A mutable appended roster has explicit initial stored values in
`Split.config.additionalRecipients`, using the shared `{ rowId, recipient,
allocation }` representation. For example, a configured constant platform row can
hold 1,500 bps while the initial appended worker roster holds 8,500 bps. Both are
validated and constructed atomically; there is no incomplete post-deploy setup.
Only the appended roster's declared membership may later change. Its rows cannot
collide with, delete, reorder or replace configured rows. The initial roster is
included in authored English/deploy review and deployment trustline checks.

The existing `SplitConfig` constructor shape remains accepted. Mutable appended
rosters use the new config-bearing `StoredSplitConfig { policy, additional }`
wrapper in the same constructor argument. Unknown/malformed wrappers fail closed.
This is an ABI/spec change for the new reviewed artifacts, not a retrofit.

`field_policy()` continues to return the original constructor policy and values.
Separate `CurrentPay`, `CurrentSplit` and `Additional` instance keys hold changed
stored values. `current_config()` returns those current values and their revision;
the TS decoder separates immutable field modes from resolved configuration.
Split's `initial_config()` also exposes the original appended roster at revision
zero. Original graph, pipeline and artifact snapshots are never rewritten.

Each successful changed child emits `config_v1`, with its node identity in the
topics and the full resulting `PayState`/`SplitState` in the data. The data contains
its revision, stored configuration and immutable asset/routing bindings. #1169 can
retain/reconcile every confirmed revision, including direct external updates,
without treating today's graph or latest registry as historical evidence.

## Obligations, races and unsolicited funds

Before changing any node, the root reads every node's `mutation_status()` and
checks the full immutable topology, same admin/asset, current revisions, and
**accounted obligations**, not raw token balances. Every mutated node repeats its
local checks when reached through authenticated forwarding. A single transaction
preflights and applies the complete group, so a failed later change rolls back
all earlier changes. Payment and mutation calls touch the same instance state;
they cannot commit an interleaved check/update. Old reviewed payment bindings fail
on chain before the root pulls funds after an affected revision advances.

On admitted policy paths, Receive and Pay consume/forward/refund only the current
call's conserved budget; their legacy prefunded and cancel/routing paths reject
policy instances. A terminal stored fixed Split retains accepted amounts in its
`AccumulatedBalance` until its batch is funded. **Any nonzero accepted accumulation
blocks mutation anywhere in the path**, including upstream Pay edits. Losing or
clawing back tokens does not clear that accounting: even zero raw balance cannot
make the obligation disappear. Settlement must actually discharge it; there is no
timeout or admin "clear" operation.

Unsolicited transfers are not accepted obligations. They do not enter the accounted
budget and never select another payment's recipients. Mutation transfers no tokens;
ordinary solvent calls preserve surplus above accepted accounting. Sending
unsolicited tokens therefore does not itself reserve a mutation slot. External
asset losses do not erase accepted accounting: operator funding can restore
solvency for settlement under the original terms, but cannot unlock mutation
without actually discharging those obligations. Fungible repair tokens are not a
separate refundable deposit. No update relabels a deficit or discards evidence.
Supported asset resolution and exact transfer-delta checks retain the existing SAC
boundary.

## Versioned artifact compatibility

`EXECUTION_V1_WASM_HASHES` retains the previously reviewed execution-only hashes.
Their snapshots continue to discover/prepare/execute with `mutation: false`.
`MUTATION_V1_WASM_HASHES` separately identifies the new standard root/Pay/Split
builds. A mutable graph requires those exact hashes for **every** participating
node, not merely the edited node. Unknown, mismatched-kind or changed executable
hashes fail closed. New hashes advertise `mutation: true` only when their verified
getters agree with that pinned metadata. Old artifacts cannot gain capability by
changing a flag. Existing all-constant and execution-input graphs remain supported
on their pinned old artifacts.

SDK execution discovery now accepts the server-verified boolean mutation capability
while retaining execution-only responses with `mutation: false`. Older strict SDKs
that only accept `false` may reject discovery for **new** guarded artifacts and need
the updated SDK. Their existing execution-only deployment responses are unchanged.
No app/API/SDK version is bumped or package published by this implementation PR;
follow the release policy when preparing an actual release.

Current local release hashes (Rust 1.95.0, locked dependencies, wasm32v1-none):

| Kind    | SHA-256                                                            |  Bytes |
| ------- | ------------------------------------------------------------------ | -----: |
| Receive | `2bd7fd8d6251092f49833513f50e3c04b9188f8da47a7cb73e5c84b521dc16ec` | 39,407 |
| Pay     | `dcfc03ef0b4f608148313059c531e034ae43d3c2b6ae6149f9766e341c887318` | 50,918 |
| Split   | `589df78f21dfacceaefb59a2b66b019afb487090c3cd31beaf04d5f540768da9` | 65,926 |

[Raw read-only RPC observations](evidence/2026-11-01-stellar-network-settings.json)
on **2026-11-01**, 10:05:02.563–10:05:03.631 UTC, used `getLedgerEntries` configuration
key `AAAACAAAAAA=` (`ConfigSettingContractMaxSizeBytes`):

| Network/provider                                 | Observation ledger | Entry last modified | Maximum contract bytes |
| ------------------------------------------------ | -----------------: | ------------------: | ---------------------: |
| Public testnet `soroban-testnet.stellar.org`     |          5,500,772 |                 702 |                131,072 |
| Mainnet `soroban-rpc.mainnet.stellar.gateway.fm` |         65,248,343 |          57,941,156 |                131,072 |

The mainnet provider is in the official [RPC provider list](https://developers.stellar.org/docs/data/apis/rpc/providers);
`getNetwork` returned the public-network passphrase and protocol version 29.
The largest local Split build fits both observed 128 KiB code-size limits. These
reads performed no signing, simulation, send, upload or activation. Size fit is
not full resource/upload or live deployment acceptance; recheck the target
network's current settings during an authorized rollout.

```sh
cd contracts
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-splitter
cargo test --locked -p payer --test stored-mutation
cargo test --locked -p payer --test stored-mutation -- --ignored --nocapture
cargo test --locked -p payer --test runtime-inputs wasm_execution_uses_identical_binding_abi -- --ignored --nocapture
cd ..
node --import tsx scripts/check-execution-artifacts.ts
```

The verifier defaults to the current source's guarded-mutation manifest. When
rebuilding the retained execution-only source revision, use `--execution-only`.
Neither command uploads WASM or writes registry/environment values. Actual upload,
registry synchronization and deployment require separate authorization and a
reviewed rollout/rollback plan. Rollback must retain existing snapshot resolution;
removing trusted old manifests would break existing supported deployments.

## Local evidence and limits

| Compiled-WASM fixture                                            | Instructions | Metered memory | Writes | Event bytes |
| ---------------------------------------------------------------- | -----------: | -------------: | -----: | ----------: |
| Root → Pay → Split, two-node grouped stored update               |    7,585,293 |      6,446,526 |      2 |       1,744 |
| Same path, replacing 19 appended rows plus constant platform row |    8,749,329 |      6,482,658 |      1 |       3,944 |
| Existing execution fixture on new guarded artifacts              |    7,070,263 |      6,519,258 |      7 |       1,716 |

The older reviewed execution-only artifact fixture measured 6,796,340 instructions
and 6,480,879 metered memory bytes; its evidence remains in
[execution v1](execution-v1.md#local-verification-and-resource-evidence). These are
local host measurements, not fees, throughput, maximum-path network acceptance or
a performance guarantee. Structural bounds (40 path nodes, 20 combined Split rows)
do not prove that every shaped request fits current network limits. Simulation
must enforce the actual resource envelope before signing; limits are network
settings that can change. See Stellar's
[resource-limit documentation](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering).

Additional read-only protocol-29 observations on 2026-11-01 at testnet ledger
5,500,772 and mainnet ledger 65,248,343 returned the same limits: 400,000,000
instructions, 41,943,040 memory bytes, 16,384 event bytes and 132,096 transaction
bytes. The `getLedgerEntries` keys were `AAAACAAAAAE=` (compute), `AAAACAAAAAQ=`
(events) and `AAAACAAAAAU=` (bandwidth). The local SDK's 100-million-instruction
test budget is stricter than that observed CPU setting, but uses local protocol
and cost parameters; these reads are not RPC simulation of the new contracts.

The SDK v26 debug auth observer can exhaust its separate shadow budget. Bounded
functional fixtures disable that observation hook while retaining real source
account authorization and default CPU/memory limits. Separate unlimited-harness
profiling retains auth/IO observations and asserts CPU/memory below those test
bounds. Native security tests also enforce exact admin authorization trees. Neither
profile is proof of live resource suitability. No funded wallet, service deploy,
registry activation, mainnet write or live acceptance is performed by #1168.
