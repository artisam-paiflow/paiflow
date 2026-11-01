# Opt-in hosted policy-v1 payments

[#1162](https://github.com/webnxt-2030/pinkraft/issues/1162) adds a wallet-only form at
`/trigger/:deploymentId` for the [immediate execution v1](execution-v1.md) subset.
The owner explicitly enables it from the deployment page. New and existing rows
default to disabled; migration does not publish any deployment. No Paiflow account
or API credential is required from a payer. This is a direct link, not a gallery.
Mode-less legacy hosted payments keep their existing behavior.

The form reads verified confirmed capabilities/configuration, collects every
declared Pay/Split input, and preserves constant recipients and allocations. It
shows the exact prepared payer, asset, recipients, allocation sources, amounts,
configuration revisions, maximum transaction fee and pinned network before asking
the existing wallet connection to sign the payment. Monetary arithmetic uses integer stroops;
token input accepts at most seven decimal places and percentage input at most two.
The last Split row receives percentage rounding. A constant-only fixed Split can
accumulate deposits; its review distinguishes batch allocations from an immediate
payout. Terminal Pay refunds only that invocation's unused budget.

Before the first preparation can reserve a payer, the form obtains a separate
wallet ownership signature. The UI explains that this is a sign-only proof and
that payment review/signing follows separately. The challenge is a fixed-fee,
sequence-zero envelope with exactly one `manageData` operation. It cannot execute
on Stellar and is never simulated, broadcast, stored or logged. This narrow proof
is not a login/session or SEP-10 authentication service. It requires the named
G-address's own signature, matching the existing payer source-signature model;
contract accounts and alternative multisignature-only authorization are not added.

## Boundaries and routes

| Route                                         | Guard and purpose                                                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PATCH /api/deployments/:id/hosted-execution` | Owner session, ownership, sandbox refusal, write rate limit, ACTIVE admission, strict boolean body and transactional audit. Enabling verifies real executable capabilities.                                            |
| `GET …/hosted-execution/state`                | Explicit opt-in, CONFIRMED ACTIVE deployment on the environment network, bounded RPC reads and rate limits. Only confirmed contract configuration is returned, never the graph, contacts, owner or API credentials.    |
| `POST …/hosted-execution/ownership`           | Explicit opt-in and rate limits; strict payment/capability body produces a stateless, short-lived ownership challenge, without creating a payer reservation.                                                           |
| `POST …/hosted-execution/prepare`             | Same visibility/service guards; strict payment plus random browser recovery capability and first-prepare wallet ownership proof. Reuses `prepareExecutionPayment`, durable idempotency and exact intent persistence.   |
| `POST …/hosted-execution/submit`              | Receipt capability and exact intent, unchanged source-signed envelope, live artifact/revision checks and the existing one-send lifecycle. First send additionally requires owner opt-in under the deployment row lock. |
| `POST …/hosted-execution/receipt`             | Receipt capability; reconciles only the original durable hash through `reconcileControlIntent`. Existing financial recovery remains available after opt-out or retirement admission closes.                            |

The middleware exposes only the five enumerated public child routes. The management
route remains session-scoped. All public routes have address-wide and deployment/IP
limits. Generic service admission and the existing execution receipt protect
retirement, financial evidence and replay semantics. Owner opt-out and the first
preparation/send serialize under the same deployment lock; a stale visibility read
cannot authorize a new first send after opt-out. Public submissions carry explicit
public-wallet attribution rather than an invented API token.

Visibility is a hosted UI choice, not on-chain access control. Direct contract calls
remain subject to the payer-bound on-chain policy. Disabling the form neither
rewrites constants nor cancels, hides or clears an uncertain payment.

## Recovery and privacy

The ownership proof binds a domain/version, deployment, payer, every canonical
payment input (including array order), recovery-key hash and pinned network. The
server reconstructs and compares the entire expected transaction body, checks its
180-second validity window and verifies the payer signature before simulation and
again under the preparation admission lock. Modified sources, operations, fees,
preconditions, memo, fee-bump envelopes, signatures and expired proofs fail closed.
An anonymous caller cannot reserve a victim payer by supplying its public address.

Before prepare, the browser saves a random 256-bit recovery key and its validated
request. The server stores the receipt-capability hash atomically with the
financial reservation in the same admission transaction, scoped to the
deployment/network/action and a namespaced idempotency identity. No postcommit
capability-marker write can strand an admitted payment. Keys are submitted
in JSON bodies, never URLs or public props; log redaction covers them. A lost prepare
acknowledgement can recover the same preparation without another ownership proof.
Preparation recovery requires the same capability and exact original request.
Receipt/status recovery remains available after opt-out or retirement admission
closes, including retained history from before atomic marker persistence: the
original random key must match the exact deployment/network/action and namespaced
idempotency hash. That fallback never authorizes a new preparation or first send. Interrupted ownership
signing is safe to retry because that proof cannot execute a payment; interrupted
payment signing retains the stricter unresolved-attempt behavior below. A distinct
browser `ownership` phase permits explicit input editing after proof cancellation
or reload, without directing the payer to a nonexistent receipt. The browser saves
and reads back `preparing` before sending any verified preparation request, so a
lost acknowledgement cannot expose that safe-edit path. Legacy `preparing` records
remain conservative. A restored `preparing` record never downgrades to `ownership`
on a missing server row or an ownership-required error: its original server
request may still be simulating and can commit later. It retains the same key and
request. If no intent/hash has ever been learned and recovery requires ownership,
the wallet may sign another sequence-zero proof **for that same immutable key and
request**, while the browser stays `preparing` and non-editable. This recovers an
RPC failure before admission without inventing a replacement identity; concurrent
original/retry simulations serialize into one durable intent. It never signs or
resends a payment automatically. A known intent/hash, payment-signing attempt or
submitted state cannot use this fallback or discard its receipt. Reusing a key with changed inputs
conflicts once an intent exists. Different recipients use separate completed payment
intents, not a persistent last-recipient configuration.

The client checks the confirmed immutable Receive minimum, required inputs and
final Pay/Split totals before creating a recovery record or requesting ownership
proof. A request already dispatched by an older/custom client still cannot be
edited merely because it returns validation/resource failure or no receipt yet.
Re-proof only retries its original inputs. A permanently invalid original request
may therefore require owner/operator-assisted recovery; this change adds no
cancel/tombstone protocol and makes no general safe-editing claim after dispatch.

Before wallet access, public hash/intent/signing-attempt identity is saved and read
back. The wallet must return the unchanged transaction for the original payer and
network. Signed XDR exists only in memory and the submit request, never browser or
database recovery storage. Reloading or interrupting signing never automatically
signs/submits again. Only explicit wallet refusal permits reusing that same unsigned
preparation; unknown signing or send outcomes retain the receipt and block a new
payment. Status checking never resends. Expiry alone does not free the reservation:
the common lifecycle requires authoritative finality/non-inclusion coverage.

Editing reviewed inputs requires another preparation after the original receipt is
reconciled. Leaving review does not clear the original reservation. After opt-out,
the page shows only a generic recovery screen with no private flow name. Existing
receipt holders can still reconcile; a stranger cannot retrieve an intent, unsigned
envelope or inputs using an intent ID alone. A retired terminal receipt can be read
without starting new service work. Browser storage holds the capability and public
financial inputs, so a lost browser profile may require owner/operator-assisted
recovery; it does not grant anyone wallet signing authority.

## Local evidence and release limits

Focused tests cover strict schemas, ownership-proof/admission adversarial cases, precise conversion, constant platform shares,
rounding, public/owner guards, safe projections, a real PostgreSQL prepare race,
opt-out during first-send admission, retained receipts and middleware allowlisting.
Component end-to-end fixtures use an in-memory sign-only wallet with real Stellar
transaction signatures and stubbed HTTP/chain transport to execute varied
destinations, refusal, interrupted signing/reload, lost prepare acknowledgements,
stale revisions and unknown finality. These are not a real browser wallet/network
acceptance claim. No funded transaction, service deployment or artifact upload/
activation is performed. Cross-layer rollout/resource acceptance remains #1163;
actual activation requires separate authorization. This new policy-v1 path does
not claim full remediation of historical legacy public submission issues #550/#851,
and #937's live/device acceptance remains open.
