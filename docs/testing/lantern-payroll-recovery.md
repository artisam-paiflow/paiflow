# Payroll update recovery

Payroll employee updates use the existing deployment/network contract-action Web
Lock. Before the update POST, the browser durably records an unpredictable public
request UUID and the `prepare` phase. This endpoint can already send multiple
relayer transactions, so neither a lost response nor navigation makes it safe to
repeat. Errors and malformed responses retain this marker indefinitely. There is
no new relayer path, server receipt or database migration in this change.

If transaction hashes arrive, recovery records the complete validated list before
considering whether the original view still exists. Every hash is checked through
the read-only transaction-status endpoint. SUCCESS and FAILED are terminal; only
terminal proof for every hash permits compare-and-clear of that exact request and
hash list. A failed member reports possible partial completion, rather than an
all-or-nothing result. Pending, NOT_FOUND, HTTP failure and elapsed time never
permit replacement. Reload and the status button only read status, never repeat
prepare or submit.

The route's legacy PAYROLL branch returns an unsigned transaction without a chain
write. Only this unsigned-only response releases the prepare marker for the
wallet flow. It may already have synchronized Employee database rows. Editing or
canceling the wallet prompt does not roll back those rows. Any roster, payout-mode
or bank-detail edit invalidates the captured wallet attempt. The signing step uses
the server passphrase under CLAUDE.md §7.5 and verifies the returned body, preserved
signatures and selected signer for every wallet. It saves the verified hash before
submit-invoke and waits for finality, including when that HTTP response is lost.

Unresolved prepare requests and transaction lists block ordinary Trigger and
Generic ContractCall admissions for the same deployment/network. They share the
admission lock and pending-change notification. Malformed recovery state also
blocks admission. Neither action copies a payroll list into its single-hash
record. A second hash cannot overwrite the first payroll list.

Recovery storage contains only the public request UUID, phase and transaction
hashes; deployment/network are in its key. It contains no roster, bank details,
opaque intent, XDR or wallet secret. Browser locks and local storage must work
before any payroll update POST. Guards cover cooperating tabs on the same origin
and browser profile. Another profile, device, origin or cleared storage can bypass
these browser-only guards.

An unresolved prepare request without hashes cannot be authoritatively correlated
to server work using this route's current API. It therefore has no automatic
expiry, retry or dismissal. An operator must investigate the deployment and
server/chain history before deciding recovery outside this UI; a matching roster
or an old request age is not proof of finality. Do not clear site storage or repeat
the request to test whether it succeeded. Adding a durable server request receipt
is separate work. Automated tests prove browser admission and recovery behavior;
they do not claim an actual wallet/phone rehearsal or a delivered Lantern build.
