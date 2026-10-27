# Deployment submission recovery

Deployment review on the experimental Lantern integration branch validates the
wallet's signed envelope against the prepared body, existing signatures, expected
signer and server-provided network before sending it. See CLAUDE.md §7.5 for the
network model. This applies to each selected wallet, including desktop wallets.

The browser takes an origin-wide Web Lock scoped to flow and network before
opening the wallet. It records only the public deployment UUID and verified
transaction hash in local storage before sending the signed envelope. No wallet
secret, unsigned or signed XDR, graph or payment details enter recovery storage.
Unavailable browser locks, unavailable storage and malformed records fail closed.

Changing flow/network or leaving the view before dispatch cancels the attempt and
releases empty admission. A late approval cannot submit. Once dispatch begins,
status tracking continues for the captured deployment independently of the view;
old views cannot show success, navigate or report an old error in a new flow.

A lost HTTP response never causes another prepare or submit. Reloading review
reads the saved coordinates and checks transaction status. Users can also open
the saved deployment or explicitly check its status. Only authoritative network
SUCCESS or FAILED clears a matching deployment/hash pair. Unknown finality,
NOT_FOUND, HTTP errors and elapsed time retain it. Even a definite HTTP refusal
currently retains the record until chain finality can be established: this is a
conservative limitation, not evidence that a transaction was broadcast.

Admission protects cooperating tabs in one browser profile and origin. A separate
profile, device, cleared site storage or a different application origin can bypass
this browser-only guard. There is no server-wide flow-level deployment receipt in
this change. Prepare may leave an unsigned deployment row after cancellation;
that row is never submitted by a canceled attempt. Do not delete recovery records
or replay writes to resolve uncertain outcomes.

Automated acceptance covers lost submit responses, no replacement deployment,
status-only remount recovery, authoritative failure and success, view changes,
late signatures, invalid wallet responses, network mismatch and unavailable or
corrupt storage/locks. Existing shared-picker, cancellation, trustline and
cryptographic wallet-signature suites remain required. These checks do not claim
an actual phone/provider rehearsal or shipped Lantern support.
