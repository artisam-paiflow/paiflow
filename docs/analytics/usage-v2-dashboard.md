# PostHog usage-v2 dashboard definitions

These are reviewable definitions ready for installation after rollout; they do
not claim an existing hosted dashboard has been changed. The [tracking plan](alpha-tracking-plan.md)
defines identity, scope and denominators. Every insight must pin the actual
`AnalyticsPolicy.activatedAt`, end timestamp, network and audience.

## Operational totals

Use HogQL on the canonical server events. The following template lists the
selected cohort's submitted transaction hashes and their latest observed final
outcome; filter by the signed event time to match the DB submission-window report.
Replace START/END/NETWORK/AUDIENCE with the reviewed report parameters. Set the
query time range to include all available outcome events through the report's
`generated_at`, not just the submission window.

```sql
WITH attempts AS (
  SELECT properties.tx_hash AS tx_hash,
    any(properties.signer_address) AS address,
    any(properties.kind) AS kind,
    any(properties.deployment_id) AS deployment_id,
    any(properties.account_id) AS account_id
  FROM events
  WHERE event = 'transaction_signed'
    AND properties.tracking_version = 'usage-v2'
    AND properties.stellar_network = 'NETWORK'
    AND properties.audience = 'AUDIENCE'
    AND timestamp >= toDateTime('START') AND timestamp < toDateTime('END')
  GROUP BY tx_hash
), final AS (
  SELECT properties.tx_hash AS tx_hash,
    any(properties.flow_id) AS flow_id,
    argMax(properties.outcome, coalesce(toInt(properties.outcome_revision), 0)) AS outcome
  FROM events
  WHERE event = 'transaction_outcome'
    AND properties.tracking_version = 'usage-v2'
    AND properties.stellar_network = 'NETWORK'
    AND properties.audience = 'AUDIENCE'
    AND timestamp <= toDateTime('GENERATED_AT')
  GROUP BY tx_hash
)
SELECT count() AS submitted_hashes,
  countIf(final.outcome = 'CONFIRMED' AND attempts.kind != 'deploy') AS successful_executions,
  uniqExactIf(attempts.deployment_id, final.outcome = 'CONFIRMED' AND attempts.kind = 'deploy') AS deployments,
  uniqExactIf(final.flow_id, final.outcome = 'CONFIRMED' AND attempts.kind = 'deploy') AS deployed_flows,
  uniqExactIf(attempts.address, final.outcome = 'CONFIRMED') AS transaction_using_addresses,
  uniqExactIf(attempts.account_id, final.outcome = 'CONFIRMED' AND attempts.account_id != '') AS meaningful_active_accounts
FROM attempts LEFT JOIN final ON attempts.tx_hash = final.tx_hash
```

Acknowledged connections use `wallet_connect_succeeded` with the same policy,
network, audience and `[START,END)` receipt-event window:
`uniqExact(properties.connection_id)` and `uniqExact(properties.wallet_address)`.
Do not add browser connection events to these counts. Split lifecycle counts into
received/accepted/unresolved, rejected and chain-failed populations; never use
`NOT_FOUND` as failure. State delivery lag when comparing with DB exports.

## Journey insights and denominators

| Insight               | Configuration                                                                                                  | Denominator / limitation                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Observed activation   | Funnel: builder_opened → deploy_started → transaction_outcome(CONFIRMED, kind=deploy)                          | Observed classified account IDs entering the builder, not all provisioned accounts or humans |
| Time to first success | Earliest builder_opened timestamp to earliest confirmed deploy/outcome per account_id                          | Observed accounts with both events; report median/p90 and missing-start count                |
| Retention             | Weekly confirmed transaction_outcome activity by account_id, with first success as cohort entry                | Classified accounts with success, not addresses; separate session and API callers            |
| Feature adoption      | node_added(node_type), off_script_feature_used(feature)                                                        | Observed builder accounts; bounded approved properties only                                  |
| Friction              | error_shown, deploy_failed, trigger_failed, exception_captured by stage/error_class/error_code and app_version | Observed action starters; user_rejected separate from application/network errors             |
| Recovery              | Error → subsequent confirmed transaction outcome within the stated 24-hour window                              | Observed accounts with an error and attributable later success; explicit timeout/window      |
| Safe exploration      | $autocapture/$dead_click/$rageclick by control_id                                                              | Only marked approved controls; no comprehensive click/session claim                          |

Use event-level `account_id`, `audience`, `caller_type`, network and version;
person role changes must not reclassify historical cohorts. Anonymous/wallet-only
and API-token distinct IDs are not interchangeable with account IDs. Filter out
empty account IDs for account-based insights. Where a PostHog funnel cannot join
on `account_id`, build the account funnel in HogQL rather than joining a token's
distinct ID to its source wallet or assuming they are the same person.

Operational totals use the largest `outcome_revision` per hash, rather than delivery
order or timestamps that can tie. Pre-revision events default to revision 0; they are
not rewritten or backfilled. Operational totals rely on the outbox and stable insert IDs. Journeys depend on
browser delivery and may be incomplete. PostHog's project retention/window and
HogQL compatibility must be checked during installation; this local definition
has not executed against a live project. Preserve historical dashboards and add
a new dashboard titled **Paiflow usage-v2 — classified future cohorts**.
