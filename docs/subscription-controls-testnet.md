# Subscription controls testnet verification (#913)

Status: bounded ordinary Subscription live verification completed on hosted
testing/testnet on October 14–15, 2026. The
[initial SDK report](testing/2026-10-14-sdk-live-verification.md#updated-subscription-and-early-release-results)
records a manually invoked cron charge with an exact 0.1 XLM payout, followed by
subscriber-signed cancellation, reactivation and final cancellation. Each control's
original intent reconciled to SUCCESS; cancellation revoked allowance and
reactivation left it at zero. The report identifies the fresh deployed WASM and
separately documents old-fixture failures and the retired lost-wallet allowance.

The [published-package follow-up](testing/2026-10-15-sdk-broader-testing.md#subscription-fee-refusal-cleanup-and-unpaid-charge-prevention)
verified cancellation, zero allowance and a manual cron skip of the cancelled,
unpaid fixture. Its additional positive charge stopped before cron POST/signing/
submission because the unsigned 42.6086882 XLM estimate exceeded the 1 XLM cap.
That later charge remains unverified under the cap; unattended scheduling was
not configured or verified. See the [API verification summary](api/README.md#hosted-testnet-verification).

These results cover the recorded ordinary contracts, builds and fixtures. They do
not certify current beta/staging/mainnet availability, Dev variants or every
adversarial/recovery case below. Local mocked tests establish route/auth/schema
handling, not live coverage of those remaining cases. Capability status
`conditional` describes the implementation and live checks, not event availability.

## Acceptance and retesting checklist

Use the following checklist for further acceptance work and new target builds.
The reports above establish the completed happy-path controls; they do not mark
every rejection, interrupted-response, external-broadcast or Dev-variant check as
live-verified.

- Record hosted app revision, deployment ID/network, ordinary Subscription contract address,
  configured subscriber public address, live token and active state. Do not record credentials,
  secret keys or signed XDR.
- Verify capabilities and state with the scoped bearer token. Refuse a wrong wallet without
  creating an intent; repeat the public allowance approval workflow to check compatibility.
- With the configured subscriber's explicit wallet consent, prepare cancellation, save intent
  and hash, sign the exact envelope and submit. Verify ledger SUCCESS, cancelled state and
  zero allowance. Verify duplicate submission does not broadcast again.
- Prepare reactivation only from cancelled state; sign with the same configured subscriber.
  Verify ledger SUCCESS and active state, without an immediate charge or automatic allowance.
  Approve allowance separately and rehearse a later scheduled charge independently.
- Exercise response interruption using the saved hash/intent and explicit action reconcile.
  UNKNOWN, queue refusals and unavailable RPC history must retain the reservation. Use a
  separately broadcast prepared transaction to check finality adoption before replacement.
- Verify retirement refuses new work and preserves unresolved evidence. Existing Dev cancellation remains available with Dev disabled; Dev reactivation
  is refused. New Dev deployments remain disabled for the hackathon. Where independently
  enabled, repeat with configured Dev subscriber and changed live asset; refuse an
  unconfigured subscriber.

Record only public transaction hashes, ledger outcomes, deployed revision and observed
state/allowance. The scheduled-charge rehearsal does not form part of these controls.
