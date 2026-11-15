# Conditional reusable authoring and owner review

[#1227](https://github.com/webnxt-2030/pinkraft/issues/1227) adds ordinary-flow
builder, deployment and owner configuration interfaces for the separate
[conditional v2 domain](conditional-v2.md). This is source implementation and local
verification. Artifact upload/activation, hosted deployment, SDK publication and
funded wallet/device acceptance remain separate gates.

## Explicit draft generation

Ordinary owners explicitly opt into a conditional reusable draft. Legacy amount
conditions are not reinterpreted. The strict canvas marker is
`generation:"conditional-v2"`; `conditionalPolicies` declares version2 Pay/Split
leaf modes and an optional condition identity/threshold mode. An undeclared
threshold defaults constant within this explicit generation. Threshold mode can
be constant or admin-mutable, never per-payment. Private template schemas and
controls remain v1-only.

The supported graph is one Receive, optional sequential partial Pays, exactly one
strict amount_gt/amount_lt condition and exactly one terminal Pay, Split or Return
on each explicit True/False edge. The amount compared is what remains after the
prefix. Equality follows False. Return pays the immutable deployment owner/admin
wallet, not the current payer. One asset; no joins, nested conditions, branch
chains, delayed/recurring nodes, Swap or arbitrary fan-out.

Incomplete topology can remain a draft, with validation feedback. Deployment uses
the strict resolved domain. The builder preserves generation, field declarations,
configured row identity/order and layout during save/reopen/edit/undo; new rows
start constant. Removing/replacing the condition removes its old threshold
permission. Conditional AI editing is explicitly unavailable; late pre-opt-in AI
responses cannot overwrite the selected generation. Only ordinary-flow pages opt
into these controls. Templates receive no new declarations or workflows.

Ordinary graph writes atomically compare the captured graph and owner before
replacement. A stale legacy tab cannot erase conditional metadata, and explicit
conditional-to-legacy downgrade is refused. Name/description-only saves update
only requested metadata. Address resolution uses the same guard before contacts
are updated. Conflicts require rereading the current draft, never silent merging.

## Artifact availability and exact deployment

Draft authoring remains available before compatible artifacts are configured. The
UI and server require exact reviewed v2 hashes for every participating family,
including Router and Pay for semantic Return where used. Source schemas or flags
alone grant no deployment capability. Network selection follows
[CLAUDE.md §7.5](../CLAUDE.md#75-networks); wallet configuration is not authoritative.

Preparing a conditional deployment requires an explicit version2 request with
flow ID, source wallet and a UUID `preparationKey`. The client saves this request
under the existing preparation lock/storage scope before sending it. The server
uses the owner/key uniqueness constraint, binds flow/network/source and admits
one complete original only after building/simulating the plan. Concurrent losers
and lost-response retries return the winning original ID/hash/terms. A changed
current draft never recompiles an admitted original. No unsigned body is returned
before its complete evidence is persisted.

Each node receives one random salt and deterministic CAP-46 address. Immutable
snapshots retain the tagged canvas, full compiled definition/manifest/initial
states and ordered hash/semantic/hex-salt pipeline evidence. Return compiles through
the Pay family while retaining its authored semantic and exact owner destination.
The factory and retained v1 constructor formats are unchanged. The server checks
complete snapshots and the exact prepared factory operation on submission,
confirmation and recovery. A narrow database migration permits sealed ordinary
conditional hashes while retaining the old template-instance rules verbatim;
sealed conditional initial terms, hash, unsigned envelope and key cannot be
rewritten or deleted. No legacy deployment is retrofitted.

Conditional preparation saves the original before requesting a signature. Review
both branches, all constants and declared inputs, prefix effects, full immutable
owner address, fees/network and compiled addresses. Explicit acknowledgement is
bound to that original hash. Signing resumes only after authoritative original
recovery and the same compiled terms are verified again. Wrong source/network,
missing or changed terms and unknown preparation/signing state block progress.
Cancel, reload, storage failure or a lost response retains the same key/original;
none invites a second preparation or automatic resend.

The current configured factory must still match before new signing/first submit.
A registry change blocks that step without replacing the original. After a
submission claim, reconciliation uses the original target/body/hash rather than
today's registry. Authoritative expiry/history rules remain required. Configured
recipient trustline checks remain advisory at deployment; unknown advisory reads
do not discard an admitted receipt. Payment-time exact destination/funding checks
remain enforcing.

## Owner stored editing and recovery

The owner editor selects the explicit v2 protocol, including a mutable-threshold-only
flow. Its verified current read covers the prefix, condition and both branches,
complete hashes/revisions, immutable owner/asset and every accounted obligation.
Any accepted obligation blocks every update, including an inactive branch or debt
with zero raw token balance. A failed current read disables editing/signing; observed
history never substitutes for current truth. Initial construction evidence stays
read-only and distinct from current/proposed values and observed history gaps.

Only declared stored fields can change. Comparison, routing, asset, modes,
configured identity/order, constants and owner Return remain immutable. Threshold
zero through signed i128 max is supported; no-op, stale, constant, duplicate or
exhausted-revision changes fail. Review the complete atomic group and its exact
admin source, network, unsigned body/auth/resources/hash and fee before signing.
API access does not grant on-chain admin authority.

One existing configuration signing/recovery state machine serves v1 and v2 through
strict protocol adapters. Version2 records are explicit; old untagged records
remain exact v1. Both generations share the same storage key and origin action
lock. Malformed, mixed or opposite-generation recovery evidence remains held;
it is never stripped, hidden under another key or cleared by elapsed time.
Revision identities bind both branches and all terms/pins, ignoring only ledger
observation churn and obligation counters. A changed revision requires new explicit
review; it never silently rebases an original.

Permanent version2 refusal verification hashes the canonical strict request with
its explicit outer version2 tag, canonical server deployment UUID and network.
It separately matches the original key/admin/deployment. Retained v1 digest rules
remain unchanged. Fresh matching non-admission or authoritative terminal/expiry
proof is required before a new review/key; generic errors or missing history
provide no replacement authority. See [conditional configuration API](api/conditional-configuration.md).

The conditional public trigger page explicitly selects the new hosted protocol and
never falls back to legacy funding. See [conditional hosted execution](conditional-hosted-execution.md)
for owner opt-in, wallet ownership proof and exact-original capability recovery.
Local component, database and browser codec checks do not complete genuine wallet,
mobile-device or funded network acceptance under #1229 and earlier release gates.
