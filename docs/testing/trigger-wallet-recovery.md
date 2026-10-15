# Trigger wallet safety and recovery (#1003)

Payment triggers, deposits, and payroll allowance approvals use the same
hash-only recovery marker and browser Web Lock as contract controls. The marker
contains only the signed transaction's locally verified hash; signed envelopes
are never persisted. A browser without reliable recovery storage or Web Locks
cannot start a write. These gates coordinate this origin's cooperating controls,
not independent browsers, devices, or other dApps.

Before dispatch, a changed deployment, server-selected network, amount, mode,
template, deposit action, disabled state, or unmount cancels the old wallet attempt.
Every continuation checks that attempt's lifetime before preparing or submitting.
A late callback cannot clear a newer attempt's busy state. Ordinary rerenders
with unchanged arguments preserve the attempt.

For WalletConnect, fresh desktop selection, fresh mobile approval, remembered
mobile continuation, and wallet-return recovery all sign through one exact
approved topic, account, chain, and `stellar_signXDR` method. The live approval is
checked before and after each asynchronous signing step. A valid old signature
cannot substitute for a removed or changed session. Every wallet response must
preserve the prepared transaction body and existing signatures and contain a valid
signature by its expected source account, on the server's captured passphrase.

Mobile wallet taps retain synchronous native-app navigation using the prewarmed,
fresh pairing URI or cached exact session. Pairing-return hints now bind the
visible action and expire after two minutes. Legacy, mismatched, or ambiguous
hints require reconnecting without automatically preparing/signing the old action.
Removing a pairing hint never removes a financial pending record.

Once the marker is saved and submission dispatched, UI cancellation cannot cancel
that write, replace its hash from an HTTP response, or erase unknown finality.
Read-only polling starts without waiting for the submit response and outlives the
view. A remount or status check only polls the saved hash: it never prepares,
signs, or resubmits. Only authoritative `SUCCESS` or `FAILED` clears that hash.
Transport failures, HTTP errors, `NOT_FOUND`, elapsed time, and a closed view do
not establish failure. Unknown transactions continue blocking replacement.

## Existing public subscription allowance protocol

The existing allowance record remains the sole store for its hash and scoped
opaque intent. Its status endpoint and established definitive pre-send 4xx refusal
retain their clearing authority. There is no second hash marker or copied intent.
A lost submit response starts allowance-specific reconciliation after a bounded
wait; that wait only initiates reads and never declares expiry or clears state.

Ordinary triggers and generic contract controls read only the pending allowance
hash and block admission under the same deployment/network lock. They direct the
user back to the allowance UI for authoritative recovery; generic RPC polling
cannot expire or clear the allowance record. Corrupt allowance state fails closed.
Allowance persistence/clearing emits the shared pending event so other controls
refresh immediately, with the under-lock check remaining authoritative.

## Validation and open acceptance

Automated component tests cover synchronous mobile handoff, exact-session routing,
late/cancelled approvals, action changes, duplicate clicks, unavailable storage and
locks, hash persistence before submission, hung/lost responses, remount recovery,
terminal failure, and cross-surface allowance gates. Node tests exercise real
signed envelopes, changed bodies/signers/signatures, server-passphrase mismatch,
and withdrawn WalletConnect account/method/session approvals.

Actual Android and iOS wallet acceptance remains open. Browser/jsdom tests do not
prove operating-system handoff, background lifecycle, or a real handset return.
The experimental Lantern adapter/provider contract remains unavailable and
unverified; this change makes no new wallet-support claim.
