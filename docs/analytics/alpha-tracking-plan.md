# Alpha round — analytics tracking plan

What PostHog records during the alpha round, why, and how to read it. The code is
`lib/analytics/`; the event catalog `lib/analytics/events.ts` is the source of truth for names
and properties, so this page describes intent and doesn't restate every field.

## Scope and rules

- **Where:** beta.paiflow.xyz only. Analytics is on only when the build has
  `NEXT_PUBLIC_POSTHOG_KEY`, and only the beta Railway service sets it. Local dev, tests and
  paiflow.xyz load nothing.
- **Who:** the tester cohort is `app_env = beta` and person property `role = USER`. Filter out
  `ADMIN`.
- **Identity:** `distinct_id` is `User.id`. Usernames, emails, recipient addresses, XDR and
  graph JSON are never sent. `lib/analytics/sanitize.ts` also redacts StrKeys, seeds and base64
  blobs from every property, including autocaptured element text.
- **Not evidence:** PostHog counts are for product decisions. The Instawards metrics stay
  DB-derived (`pnpm instawards:metrics`); ad-blockers and sampling make analytics a lower bound.
  The metrics counting rule also covers **paiflow.xyz only**, so alpha activity on beta doesn't
  count toward the SOW figures as currently written.

## Questions the events answer

| Question                                                  | Events                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Can testers get in and connect a wallet?                  | `login_succeeded` / `login_failed` (server), `wallet_connect_succeeded`, `error_shown` with `error_class`             |
| Where does setup (guide §1) break?                        | `error_shown.error_class` ∈ `account_unfunded`, `min_balance`, `trustline_missing`, `wrong_network`, `user_rejected`  |
| Is the builder understandable?                            | `builder_opened`, `node_added` / `node_removed`, `edge_connected`, `node_settings_opened`, `errors_modal_opened`      |
| Which validation errors trip people, and for how long?    | `validation_error_appeared` / `validation_error_resolved` (`error_key`, `time_to_resolve_ms`)                         |
| Does the live Soroswap quote work?                        | `swap_quote_loaded` (`latency_ms`, `always_reverts`) / `swap_quote_failed`                                            |
| Do deploys succeed, and where do they fail?               | `deploy_review_viewed`, `deploy_started`, `deploy_failed` (`stage`), `deploy_confirmed` (server)                      |
| Does money move, and does the UI report it truthfully?    | `trigger_started`, `trigger_failed` (`stage`), `trigger_status_poll_failed`, `trigger_succeeded`, `trigger_confirmed` |
| Can testers see the result?                               | `deployment_page_viewed`, `live_feed_disconnected`, `live_event_rendered` (`lag_ms`)                                  |
| Do testers wander into features that aren't in the round? | `off_script_feature_used` (`feature`)                                                                                 |

Server-side events carry `source = server` and are attributed to the deployment owner.
Autocapture (clicks, including stellar.expert links), rage and dead clicks, `$pageview`,
`$exception` and session replay come from posthog-js itself.

## Dashboards to build

1. **Alpha funnel, per tester:** `login_succeeded` → `builder_opened` → `deploy_confirmed` →
   `trigger_confirmed` → `live_event_rendered`. Break down by person to see who stalled where.
2. **Test-case coverage:** `deploy_confirmed` broken down by `template_kinds` and `has_swap`.
   Swap flows map to T1/T2, a lone `PAYER` to T4, `SPLITTER` to T5/T6.
3. **Friction:** top `validation_error_appeared.error_key` with median `time_to_resolve_ms`;
   `error_shown` by `error_class` and `message_key`; `deploy_failed` and `trigger_failed` by
   `stage`.
4. **Reliability:**
   - **False-failure rate** (guide known issue #1): `trigger_status_poll_failed` whose `tx_hash`
     also has a `trigger_confirmed`. Use a SQL insight joining on `properties.tx_hash`.
   - Also chart `swap_quote_failed` ÷ all quotes, `swap_quote_loaded.latency_ms` p95,
     `live_feed_disconnected`, `deploy_failed` with `stage = finality_timeout`, and
     `deploy_confirmed.created_to_confirmed_ms` p50/p95.
5. **D3 before/after:** for `node_type = swap`, validation errors per builder session and
   `time_to_resolve_ms`, broken down by `app_version`. Swap-panel friction is already being
   recorded before the D3 rebuild lands in week 3, and the rebuild's commit shows up as a new
   `app_version`.
6. **Scope drift:** `off_script_feature_used` by `feature`. If a hidden feature keeps pulling
   testers in, hide it rather than asking testers not to use it.

Use session replay on T7 (free exploration) sessions and on any session with a rage click or a
`trigger_failed`.

## Setup checklist

1. Create a PostHog project in **US cloud**. Under _Project settings_, turn **session replay**
   on and add `https://beta.paiflow.xyz` to the authorized URLs.
2. On the beta Railway service, set **build** variables `NEXT_PUBLIC_POSTHOG_KEY=<project key>`
   and `NEXT_PUBLIC_APP_ENV=beta`, then redeploy. `POSTHOG_HOST` defaults to US cloud.
   `NEXT_PUBLIC_APP_VERSION` comes from `RAILWAY_GIT_COMMIT_SHA` automatically.
3. Leave both unset on the staging service (paiflow.xyz).
4. Sign in to beta with a test account, run T1, and check _Activity → Live events_ for
   `builder_opened`, `deploy_confirmed` and `trigger_confirmed`.
