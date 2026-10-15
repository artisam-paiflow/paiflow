# Contract action wallet recovery

`ContractCallButton` covers subscription controls, relayer confirmation, streamer
controls and payroll actions. It uses the shared selected-wallet connection and
validates every returned transaction against the prepared body, existing
signatures, expected signer and server-supplied network before sending.

## Cancellation and submission

Before admission, changing the deployment, network, action arguments or disabled
state cancels preparation and releases the browser lock. A wallet prompt can
finish later, but its cancelled attempt cannot submit. Callers provide a stable
`actionKey` containing the operation and its changing arguments. Equivalent
inline callbacks from ordinary polling renders do not cancel an approval.

Immediately before calling the submit callback, the component saves the validated
transaction hash in local storage. Once admitted, a view change suppresses stale
messages and success callbacks while reconciliation continues for the captured
deployment and hash. Neither the original action arguments nor signed XDR are
saved. A delayed, rejected or mismatched submission response cannot replace the
computed hash. Status polling starts without waiting for that response.

## Recovery and browser requirements

All contract-action buttons for the same deployment and network remain disabled
while its hash is pending. Mounting a new view resumes status reads without
opening a wallet or repeating preparation, signing or submission. The separate
**CHECK TRANSACTION STATUS** control retries reads only. Recovered outcomes do
not replay the original action's success callback.

Only authoritative `SUCCESS` or `FAILED` status removes the matching marker.
Missing hashes, nonterminal status, network errors, HTTP errors and polling
timeouts leave it in place. There is no timer-based expiry or automatic write
retry. A submission definitively refused before broadcast can consequently
remain blocked: the generic callback supplies no proof of non-submission and
there is no receipt-backed expiry path. Resolve such cases from authoritative
transaction evidence; clearing browser storage is not a reconciliation method.

Writes require both accessible, verifiable local storage and the Web Locks API.
Unsupported browsers, corrupted markers, storage failures and unavailable locks
fail closed. Origin-wide locks coordinate tabs; an in-memory guard additionally
coordinates components in the same page. A second marker is checked inside the
lock and an existing hash is never overwritten.

These controls coordinate one browser origin and storage profile. They do not
serialize independent devices, profiles, cleared storage, or callers outside
this UI. Existing server transaction and audit records remain the durable
financial history. This change adds no server-side global admission policy.

## Verification

Focused component tests cover selection timing, duplicate clicks, stale wallet
responses, changed arguments, post-dispatch navigation, remount and reload,
lost/delayed submission responses, unknown finality, status-only recovery,
storage/lock failures and selected WalletConnect topics. Node tests exercise the
installed wallet adapter, cryptographic envelope binding, hash computation,
storage parsing and lock exclusion.

Automated provider fixtures do not establish real-wallet or actual-handset
acceptance. Those remain separate gates on the same deployed build.
