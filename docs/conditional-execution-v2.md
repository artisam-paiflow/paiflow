# Conditional execution v2: contract and compiler source

[#1223](https://github.com/webnxt-2030/pinkraft/issues/1223) implements the execution
portion of the [conditional v2 contract](conditional-v2.md). Source implementation,
local verification, trusted artifact activation and live release acceptance are
separate. Conditional API deployment/discovery/execution remains unavailable in
this change; stored mutation is the next contract issue, #1224.

## Compatibility adapters

The maintained Receive, Pay, Split and Router families gain tagged conditional
initialization. There is no separate Return contract family. Retain constructor
arities and ordinary legacy/v1 argument values. Receive's next-step value, Pay's
recipient value and Split's recipients value already support tagged configuration.
Router broadens its threshold decoder from i128 to Val, accepting the existing i128
value unchanged or a strict NodeInitV2. Redundant outer arguments must match the
same complete immutable manifest. Constructors validate static topology and their
own identity without reading children that the sequential factory has not deployed.
No factory change is needed.

V1 getter return types stay unchanged. Conditional instances expose distinct
`*_v2` getters and reject old execution, getter, setter, cancel, routing and pause
entry points. A conditional declaration cannot fall through into the old execution
path. Private-template workflows, old artifact pins and initial snapshots remain
unchanged. No new template declaration or binding is introduced.

## Execution and financial evidence

The Receive root checks the complete manifest, both child branch manifests and all
reviewed revisions before debiting the payer. It validates exact prefix plus
selected-branch inputs and recomputes the strict route after upstream deductions.
The payer authorizes the complete root call. Every child requires its immutable
parent's authorization for the full context and hop amount, checks the canonical
input field set and local revision, and forwards only the invocation's conserved
budget. A terminal's incoming amount must match the authenticated amount at the
condition. Equality always selects False.

Pay preserves configured fixed/percentage/full semantics and terminal payer refund.
Return pays only its incoming budget to the immutable deployment admin/owner.
Split preserves configured row order, last-row rounding, execution-aware fixed
exact funding, and constant-only fixed accounted accumulation. Every transfer uses
exact sender/recipient deltas; unsolicited balances are not another payment's
budget. Accounted accumulation remains debt even after raw tokens disappear.
Failed selected transfers roll back funds, accounting, nonce consumption and events.
No configuration setter or obligation-clearing shortcut is added.

`pay`, `deposit`, `payout` and shortfall evidence retain their existing wire shapes.
The additional `route_v2` event carries the documented full graph bindings and
condition revision. A route event alone is not proof of transfers. Getter/event
readers must verify snapshot-pinned executable provenance as well as declared
manifest pins; SDK26 does not provide arbitrary child-WASM introspection on chain.

The local partial getter reports execution ABI2 with mutation ABI0/mutation false.
That tuple is intentionally outside production trust manifests and discovery.
Declaring mutable fields does not expose an update method before #1224. Its later
implementation must admit the whole graph's obligations and preserve every
constructor constant and field mode while allowing only declared mutable values.

## Compiler and production packet handoff

`lib/flows/conditional-v2-compiler.ts` returns a separate compiled conditional type.
It does not extend the existing runtime pipeline union. It reconstructs the entire
initial manifest in Receive/prefix/condition/True/False order at revision zero,
including the authored Return semantic and resolved owner address even though its
compiled family is PAYER.

`lib/stellar/conditional-v2-codec.ts` encodes the concrete Rust types, constructor
adapters and complete execution arguments, decodes strict versioned getters and
derives CAP-46 addresses from explicit owner/salt/server-selected passphrase.
Neither schema acceptance nor these pure codecs grants artifact trust or enables a
runtime endpoint. The generator is excluded from the deployment-image context
because it imports test fixtures, matching the existing acceptance tools.

Committed native packets use explicitly synthetic hash declarations. Actual-WASM
packets are separately generated from the built bytes. Both use the same production
compiler/codec and cover both comparisons and all nine terminal combinations, with
below/equal/above amounts after a prefix fee and distinct owner/payer identities.
The native packet test is unconditional. The guest test is ignored by ordinary
workspace CI because CI does not prebuild release WASM; it must be explicitly built
and executed as a separate acceptance check, never counted as passed because ignored.

With standard CARGO_HOME/CARGO_TARGET_DIR set to absolute task-owned directories:

```sh
cd contracts
cargo test --locked -p payer --test conditional-v2 --test conditional-v2-packets
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-splitter -p router
cd ..
node --conditions=react-server --import tsx scripts/generate-conditional-v2-acceptance.ts --wasm-directory="$CARGO_TARGET_DIR/wasm32v1-none/release" --destination="$CARGO_TARGET_DIR/conditional-v2-packets"
cd contracts
cargo test --locked -p payer --test conditional-v2-packets -- --ignored --nocapture
```

These commands do not upload, activate or submit transactions. Local budget and
code-size observations are evidence for the tested layouts, not a promise every
40-node/20-recipient layout fits network resources. Separately authorized artifact,
network, API/SDK/UI and genuine wallet/device acceptance remains part of #1229.

## Local release-build identity

[Local build metadata](conditional-execution-v2-artifacts.json) records the four
release WASM hashes, sizes, toolchain and production source inputs for this source
checkpoint. Those hashes are not added to a runtime trust manifest or registry.
The largest file is the Split build at 100,526 bytes; fitting a code-size bound does
not prove deployment/execution resources or network acceptance. Later guarded
mutation changes must produce a new build record rather than relabel these bytes.

## Local compiled-contract observations

The explicit guest matrix executed all 54 production-generated calls across 18
five-node scenarios, covering both comparisons and every Pay/Split/Return terminal
pairing. Real source-account authorization, exact transfers/refunds, untouched
surplus and route-event evidence were checked. Actual WASM hashes were compared
with the separately generated packet pins before loading each guest.

After fixture setup, every execution retained the SDK's default actual budget.
Measured instructions ranged from 25,174,308 to 32,091,319; metered memory ranged
from 23,465,306 to 24,607,986 bytes. These are local host measurements for the tested
layouts, not fees, live-network qualification or a structural-maximum guarantee.

SDK26's diagnostic authorization observer exceeded its separate shadow budget on
these complete contexts. The harness disables that diagnostic invocation hook
while retaining real source-account authorization and default actual execution
limits. Negative tests independently reject transfer-only authorization that omits
the outer payer approval, and prefunded direct-child calls lacking parent approval.
No mocked acceptance of every execution or raised execution limit substitutes for
those checks. The initial observer failure remains in the local verification logs.

Binary support for v2 does not identify an instance generation: the same new
standard-family binary retains legacy/v1 constructor decoders. Downstream readers
must use immutable constructor/snapshot generation evidence plus matching versioned
getters and verified actual hashes. Do not register one binary-wide flag that
silently upgrades old instances or rewrites retained template pins.

Retained-v1 compiled execution and guarded-mutation tests were also explicitly
run unchanged against these new binaries. Both passed with their real source/admin
authorization checks. Their existing additional unlimited diagnostic profiles and
mocked follow-up payment are separately qualified in the local verification report;
they are not new live-wallet acceptance. A draft dispatch regression showed that
speculative SDK struct decoding can abort on unrelated v1 map sizes. Constructors
therefore discriminate raw map tags/version/keys before decoding NodeInitV2,
leaving retained v1 values untouched.

The v2 constructor additionally reserves at least1bps for each configured missing
execution allocation when validating a percentage Split, including the inactive
branch. Known allocations plus those required minima cannot exceed10,000bps.
An optional execution additional roster reserves no minimum because an explicit
empty list remains valid. This v2-only invariant matches the strict foundation;
retained v1 helpers keep their original semantics.
