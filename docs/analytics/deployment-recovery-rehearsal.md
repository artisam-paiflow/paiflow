# Deployment recovery rehearsal (#808)

This runbook tests scheduled confirmation and deployment setup after a browser
stops participating. A normal submit request waits for finality on the server,
so closing a browser alone does not establish that cron recovered the deployment.

## Scoped opt-in

Leave these settings empty during ordinary operation:

```dotenv
STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID=
STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL=
```

For an approved rehearsal, configure the UUID of one admin-owned test flow and
an ISO timestamp with a timezone, at most one hour ahead. Both settings are
required together. Configuration on mainnet is refused; network authority remains
[CLAUDE.md §7.5](../../CLAUDE.md#75-networks). Expired settings are inactive, even
when configuration is memoized. Clear both afterward.

Only the selected flow's owner submitting with an ADMIN session on testnet takes
this path. Other flows, USER/SANDBOX sessions, partner API calls, relayer calls and
ordinary submissions retain their existing behavior. There is no request-body or
browser override.

The rehearsal still verifies ownership, prepared-envelope hash binding, feature
availability and rate limits. It records the signer and claims the deployment
before sending. After RPC accepts or recognizes the same queued transaction, it
records `ACCEPTED` and returns `SUBMITTED` with the transaction hash. It does not
poll finality, initialize deployment setup, or report a failure/success prematurely.
RPC refusal and ambiguous send errors keep their existing handling. The existing
`DEPLOY_SUBMIT` audit records `reconciliationRehearsal: true` for this path.

## Live procedure

1. Obtain approval for merge/promotion, deployment and rehearsal configuration in
   **hackathon-testing**. Preparing this change does not authorize those actions.
   Verify the runtime commit, testnet setting and authenticated every-minute
   reconciliation schedule before asking for a signature. No manual cron trigger
   or scheduler change is needed.
2. Use an admin-owned **HTTP Webhook → Pay** test flow, with XLM and the user's
   testnet wallet as recipient. Notifications should be off. Review the graph and
   recipient; do not invoke the webhook or send a payment in this rehearsal.
3. Set the two settings for this flow, with enough time for the approved rollout
   and signature. An expiry more than one hour ahead fails config loading; if
   the window expires before signing, update it before preparing the transaction.
   Verify configuration flags without publishing credentials or raw env output.
4. Restore normal deployment writes in the controlled test browser. If keeping
   analytics interception for privacy tests, state that browser events are
   suppressed; authoritative server/outbox events must still be audited separately.
5. The user prepares and signs **one** deployment. Wallet signing stays in the
   browser. Never save or log private keys, signed XDR, credentials or raw request
   bodies. Keep the new deployment ID and transaction hash as evidence.
6. On the submit response, move the browser to a blank page and leave it idle.
   Inspect persisted state read-only: deployment `SUBMITTED`, transaction
   `ACCEPTED`, unset confirmation/setup fields and a scheduled `nextCheckAt`.
   Cron may already have run by the time of inspection; use its timestamps and
   `checkAttempts`, not an assumption that a missed pending snapshot was observed.
7. Let the existing scheduler run. Confirm `checkAttempts > 0` and
   `lastCheckedAt`, then a verified `CONFIRMED` outcome, ledger and confirmation
   time. Check the deployment is `CONFIRMED`, its deterministic pipeline snapshot
   is preserved, its trigger contract address resolves, and a webhook secret was
   initialized. Record only the secret's presence, never its value.
8. Verify the `DEPLOY_CONFIRM` audit and final `transaction_outcome` event each
   occurred once, the outbox delivered, and PostHog's timestamp-bounded result
   contains one authoritative final outcome. Additional scheduled runs must not
   duplicate setup or rotate the secret. Reopen the deployment only after checking
   the server evidence, and verify its credential panel renders.
9. Clear both rehearsal settings and verify normal submission behavior. This
   cleanup does not require deleting the deployment or changing historical rows.

RPC submission confirms enqueueing, not finality; see Stellar's
[sendTransaction reference](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction).

## Evidence and limits

Record app commit, environment/network, flow/deployment IDs, transaction hash,
submission and reconciliation times, revisions, ledger, setup-presence checks,
audit/event counts and delivery status. Preserve only sanitized evidence.

Local tests use isolated Postgres and mocked RPC. They cover the real submission
and confirmation/setup functions, an RPC read interruption followed by recovery,
stable webhook credentials, repeated reconciliation, same-envelope retries and
durable event deduplication. They do not establish hosted scheduling, chain
finality or live PostHog delivery. The initial hosted rehearsal was recorded as completed on 6 October 2026;
see [#808 verification status](808-verification-status.md) for the historical
result, evidence limits and remaining current-beta verification. This does not
establish complete crash atomicity or authorize repeating the rehearsal. Testnet accepts the transaction and deployment
fees still apply; this path changes who observes finality, not transaction validity.
