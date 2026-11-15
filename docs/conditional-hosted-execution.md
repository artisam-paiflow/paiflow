# Conditional hosted payments

[#1228](https://github.com/webnxt-2030/pinkraft/issues/1228) extends the existing
wallet-only `/trigger/:deploymentId` form to explicitly constructed conditional-v2.
The existing owner setting remains disabled by default. Enabling requires an actual
complete fenced capability read; schema acceptance or a marker grants no capability.
A payer needs a wallet, with no Paiflow account or fabricated API credential.
See [conditional authoring](conditional-authoring.md) and the
[canonical environment network model](../CLAUDE.md#75-networks).

One existing form, wallet connection, origin lock, signing recovery and payment
sender serve v1 and conditional protocols through private adapters. All five existing
public hosted operations (`state`, `ownership`, `prepare`, `submit`, `receipt`) and
owner visibility use `?version=2` for separate strict conditional schemas. Missing/1
retains v1; duplicate or unknown selectors fail. Saved generation must match before
its evidence is interpreted. Templates and legacy entry points gain no new formats.

## Selected inputs and actual review

Only declared prefix plus selected terminal inputs are requested and accepted.
The condition compares the invocation amount after every upstream Pay deduction.
Both amount comparisons are strict; equality takes False. Changing an editable
route clears the old terminal fields/roster. Thresholds are constant or admin-mutable
configuration, never payer inputs. Requirements refresh before proof-bearing prepare.

Actual returned original terms require explicit hash-bound review before signing:
payer, asset, network, fee, full graph pins/revisions, post-prefix amount, comparison,
threshold, selected branch, recipients, allocations, refund and accumulation.
Return to owner pays the immutable deployment owner/admin, **not the payer**.
Terminal Pay refunds only unused invocation budget to the payer. Percentage rows
floor allocations and the last Split row receives the remainder. Execution-aware
fixed Split must exactly fund its incoming budget. Stored constant-only fixed
Split review describes configured batch allocations and accumulation, not guaranteed
immediate payouts from this invocation. Accounted obligations block configuration
updates; they do not by themselves block these ordinary payments.

The browser inspects the actual original `execute_v2` operation and all eight
arguments, root, source, network, unsigned hash, fee, finite expiry and source auth.
Complete current terms must match the original before first signing/sending,
including inactive-branch pins/revisions. Threshold, amount or revision changes never
silently reroute/rebase an admitted original. Authoritative service checks remain.

## Ownership and capability binding

A separate sign-only ownership envelope has sequence zero, fee100, exactly one
`manageData` named `paiflow.hosted-ownership.v2` and finite180-second bounds. It is
never simulated or broadcast. The server reconstructs the full body, checks the
named payer's own signature before admission and again under the deployment lock.
Issuing a challenge reserves nothing. The browser independently hashes its expected
binding before requesting a signature. Ownership is **not financial consent** or
a threshold/revision lock; actual returned payment terms are reviewed separately.

The proof binds SHA256 of recursively key-sorted canonical JSON:

```text
{domain:"paiflow.hosted-execution.ownership",version:2,
 deploymentId:<canonical server UUID>,payer,network,networkPassphraseHash,
 requestDigest:SHA256(canonical(strict payment)),
 recoveryKeyHash:SHA256(UTF8(raw recovery key))}
```

Array order remains meaningful. This inner bare-payment digest differs from the
common lifecycle's outer `{version:2,deploymentId,network,input:<strict payment>}`
digest. Old v1 proof names/bodies remain exact; neither generation accepts the other.
The shared idempotency identity stays SHA256 of `hosted-execution:<raw recovery key>`.
The independent access hash is atomically persisted with admission. V2 requires
that marker; retained pre-marker v1 evidence is never a v2 fallback. Capability
authentication precedes generation interpretation and any original/conflict details.

## Recovery and privacy

Both generations share the same physical browser key and origin action lock.
New literal-v2 records bind deployment/network, exact request, capability, phase,
original intent/hash and signing attempt. They store no transaction bytes, wallet
secrets or API credentials. Unknown/malformed/opposite-generation records remain
held. Readback must succeed before wallet access. Any held request's exact saved
inputs are read-only and distinct from current terms; refreshed conditions cannot
present a new branch as the original when no original terms have been recovered.

Ownership-only records before proof dispatch retain existing safe edit/cancel
behavior. PREPARING is saved before proof-bearing prepare dispatch. Missing rows,
validation errors, timeout, expiry, RPC failures and lost acknowledgements never
authorize clearing an uncertain original. Reproof uses only the same key/request
with no known intent/hash/signing attempt. Obsolete branch inputs can remain held
if changed terms no longer admit them. This change adds no cancellation or durable
non-admission protocol and does not promise a reset from database absence.

Original request/capability/intent/hash survive reloads and lost responses. Unknown
signing/finality blocks fresh payments and never auto-resends. Opt-out blocks fresh
challenge/preparation and first send under the same deployment lock. Exact prepare
response recovery remains visibility-gated as in v1; original receipt/reconcile
stays available after opt-out/retirement without current terms or live configuration.
Postclaim recovery follows only the original hash. Disabled pages show a generic
payment receipt screen without private flow names.

Public responses are strict financial allowlists. The immutable owner's **wallet
address** is required public Return evidence; owner User/email, contacts, authored
graph/labels, private history, tokens and raw diagnostics stay private. V2 public
errors use fixed safe messages/fields. Existing public rate limits and path allowlists
remain. Legacy QR/SEP7 and embedded graph formats stay unsupported for conditional
flows, rather than infer a native asset or old invocation from a Receive shape.

## Evidence and release limits

Meaningful schema/domain, PostgreSQL race/lifecycle, privacy and component tests
verify local source. Isolated Chromium with native WebCrypto and no global Buffer
checks helpers; it is not genuine wallet, handset or funded network acceptance.
Full local CI and exact-candidate independent review are recorded separately from
hosted CI. No artifact upload/activation, registry change, SDK publication, hosted
deployment or funded transaction is implied. #1229 and predecessor/security/device
gates retain their own evidence; unperformed live gates remain open.
