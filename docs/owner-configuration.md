# Owner stored-configuration review

Issue #1170 adds the owner editor for [guarded Pay/Split updates](mutation-v1.md).
It consumes the [existing exact admin-signed lifecycle](api/configuration.md),
not a relayer or a new signing engine. Source support does not activate artifacts,
deploy services, publish an SDK or complete live wallet/device acceptance. Release
order remains execution, instances, mutation; readiness is tracked by #1171.

## Authoring a new deployment

On the supported immediate Receive → Pay → terminal Pay/Split path, the builder
can declare eligible recipient and stored payout/allocation fields constant,
payer-supplied where supported, or admin-mutable. Pay execution inputs cover only
its recipient; stored mutable payout values are fixed amounts or percentages.
Full-amount Pay remains a constant rule. Other block types gain no mutation mode.

The Split allocation group has one authority: stored mutable allocations/appended
rows cannot mix with payer-supplied allocations/appended rows. Configured row
identities and order remain stable. A mutable appended roster has complete initial
wallets and allocations. Its local editor shows validation errors and an explicit
**Apply stored roster to draft** action: incomplete rows do not replace the saved
graph. Applied configured and appended shares must total 100%; duplicate recipients
and more than 20 combined recipients are refused. Fixed amounts use canonical
stroop strings. The ordinary graph validator runs before deployment.

Draft modes can be changed before deployment. Once deployed, modes, constants,
asset, routing, allocation kind and configured row membership/order stay fixed.
The deployment controls require reviewed guarded hashes for every participating
node. Retained execution-only, legacy, unknown and mixed generations cannot gain
mutation by changing a UI declaration. Existing deployments are not retrofitted.

## Current values, proposed values and signing

The private owner deployment page offers stored editing only for declared mutable
flows on the environment network. Owner session, sandbox, service retirement,
credential and rate checks remain in the backend. The editor enables operations
only after a verified current getter response establishes the full guarded path,
admin, revisions and accounted obligations at one confirmed ledger.

The page separates:

- Original graph values and lifetime modes under **Initial deployment snapshot**.
- Verified **Current confirmed values**, with their observation ledger.
- **Proposed stored values**, including unchanged constants and full recipients.
- Retained **observed history**, with event/observation ledgers and missing-revision
  counts. It is explicitly incomplete and never a fallback for failed live reads.

Current reads refresh every 15 seconds and on explicit checks. A revision change
does not silently rebase edited terms: preparation stops until the owner explicitly
refreshes the review. Failed current reads hide the unverified terms and disable
editing/signing. Nonzero accounted obligations anywhere in the path block updates;
a zero raw token balance cannot clear those obligations.

Preparation saves the original request and idempotency key before dispatch. Before
wallet access, the page obtains the original server preparation again, checks the
complete receipt identity and exact reviewed arguments/path/artifacts, and reviews
current/proposed values, expected revisions, admin/source, maximum fee and network.
The selected admin wallet signs that exact envelope. The existing wallet helper
checks the source signature, network and unchanged transaction body/hash. No
developer private key or signed envelope is stored in browser recovery or logs.

Origin-wide action locking and checked storage writes fence concurrent tabs.
The signing-attempt marker is saved before requesting a wallet signature, and the
submitted marker before sending. Only an explicit wallet rejection restores the
same prepared signing opportunity. Interrupted signing, response loss and unknown
submission/finality preserve the original identity and expose reconciliation only.
There is no cancel, timeout clearing, blind resend or fresh-key recovery shortcut.

## Safe recovery after a preparation refusal

A failed simulation or an absent row does not prove that an earlier concurrent
preparation cannot still admit. Known failures **before intent creation** can now
produce a durable `MutationPreparationRefusal`. Under the same deployment row lock
used by keyed control creation, the server rechecks active owner/credential
admission, returns an already-admitted original intent if present, or records an
immutable non-admission fence. Every late mutation or execution creator checks
that fence under the lock. Refused keys never expire, change or admit later.

The first failure preserves its existing HTTP code, safe message, field errors
and details, adding `error.fields.preparationRefusal` as a single JSON string.
It binds refusal ID/time, deployment, network, admin, hashed key and canonical
original-request digest. Replay retains the reason code with a safe explanation;
the server does not retain raw upstream messages. Different payloads under the
same key conflict. Programming/unknown errors, authorization failure, retirement,
post-commit errors and ambiguous responses issue no non-admission proof.

The browser verifies the proof against its exact parsed original request and key,
including ordered arrays. A saved local refusal/final label is not authority:
**Review current terms** fetches fresh authenticated evidence
again before advancing recovery. Only a matching durable non-admission fence, or
consistent authoritative SUCCESS/FAILED/verified EXPIRED reconciliation, allows a
new key and freshly reviewed request. A refusal never clears an admitted intent,
signed transaction, unknown finality or financial work.

Migration `20261101140000_mutation_preparation_refusals` adds retained evidence with
an update/delete rejection trigger and restrictive deployment relation. Ordinary
retirement keeps that evidence. Tests use process-owned scratch databases and drop
those databases instead of disabling retention or deleting financial fixtures.

Local component tests exercise real source signatures, reload, storage/lock failure,
cross-tab changes, stale revisions and explicit refusal recovery. DB tests exercise
late-admission/refusal races and immutable evidence. These are local proofs, not
browser/device, hosted availability or funded network acceptance.
