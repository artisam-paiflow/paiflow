# Subscription controls testnet verification (#913)

Status: pending. No hosted app or on-chain transaction was changed during implementation.
Local mocked tests establish route/auth/schema/action handling and reuse of the durable
wallet-control protocol; they do not prove the deployed contract revision or hosted API.
Keep #913 open until separately authorized rehearsal records the evidence below. Capability
status `conditional` describes the implementation and live checks, not event availability.

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
