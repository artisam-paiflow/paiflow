# Alpha round — analytics tracking plan

What PostHog records during the alpha round, why, and how to read it. The code is
`lib/analytics/`; the event catalog `lib/analytics/events.ts` is the source of truth for names
and properties, so this page describes intent and doesn't restate every field.

## Scope and rules

- **Where:** the beta is `beta.app.paiflow.xyz`. Analytics is on only when the build has
  `NEXT_PUBLIC_POSTHOG_KEY`; local dev and tests load nothing.

  > **Currently off.** Since 16 September the beta shares the **staging** Railway service with
  > `paiflow.xyz` — one service, one build, one database. The PostHog variables were only ever set
  > on the retired `prod` environment, so no build carries the key today and the round is
  > untracked. `/ingest/*` returns 404 whenever the key is absent
  > (`app/ingest/[...path]/route.ts`), which is the quickest way to check.
  >
  > Re-enabling means setting the variables on the staging service and **rebuilding** — they are
  > inlined at build time, so a restart will not do. Note that one build now serves both hostnames,
  > so turning analytics on turns it on for `paiflow.xyz` too, and `app_env` can no longer separate
  > the two: filter dashboards on `$host` instead.

- **Who:** testers are `app_env = beta` events from people whose `role` isn't `ADMIN`. Every
  dashboard insight applies both filters. Since the two hostnames share one build, `app_env` alone
  no longer isolates the beta — add `$host = beta.app.paiflow.xyz` when analytics is switched back
  on, or `paiflow.xyz` visitors are counted as testers.
- **Identity:** `distinct_id` is `User.id`. Usernames, emails, recipient addresses, XDR and
  graph JSON are never sent. `lib/analytics/sanitize.ts` also redacts StrKeys, seeds and base64
  blobs from every property, including autocaptured element text.
- **Not evidence:** PostHog counts are for product decisions. The Instawards metrics stay
  DB-derived (`pnpm instawards:metrics`); ad-blockers and sampling make analytics a lower bound.
  The metrics counting rule used to cover **paiflow.xyz only**, which kept beta activity out of the
  SOW figures. That host split no longer exists: since 16 September both hostnames are served by
  one service reading one database, so `scripts/instawards-metrics.ts` cannot tell them apart — it
  counts rows, and there is no host column. The committed snapshots in
  `docs/instawards/evidence/` were taken against the **previous** staging database, which is
  retained as an archive and is still the system those figures reproduce against. How the figures
  are reported from here is undecided.

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
| Can testers see the result?                               | `deployment_page_viewed`, `live_feed_disconnected`, `live_event_rendered` (`lag_ms`, `source`)                        |
| Do testers wander into features that aren't in the round? | `off_script_feature_used` (`feature`)                                                                                 |

`live_event_rendered` fires once per feed row, whether it arrived over SSE (`source = sse`) or
from the fallback poll (`source = poll`); rows already in the server render aren't counted. Feed
lag is only meaningful for `source = sse`. `live_feed_disconnected` ignores the stream closing
because the page is being left.

Server-side events carry `source = server` and are attributed to the deployment owner.
Autocapture (clicks, including stellar.expert links), rage and dead clicks, `$pageview` and
`$exception` come from posthog-js itself. **Session replay is off** — see Setup.

## Dashboards

Built in the dedicated PostHog project **Paiflow beta** (US cloud, id 610680). Keep Paiflow data
there: don't reuse another product's project key. Every insight filters to `app_env = beta` and
excludes people with `role = ADMIN`, so your own check runs don't count as testers. There's also a
cohort, _Alpha testers_ (`role = USER`).

Both filters were written when the beta had a build of its own. They need `$host` added before
analytics is switched back on — see **Scope and rules** — otherwise every insight and the
_Alpha testers_ cohort will pick up `paiflow.xyz` traffic as tester activity.

| Dashboard                                                                                       | Insights |
| ----------------------------------------------------------------------------------------------- | -------- |
| [Alpha 1 — Tester funnel](https://us.posthog.com/project/610680/dashboard/2099054)              | 3        |
| [Alpha 2 — Test-case coverage](https://us.posthog.com/project/610680/dashboard/2099055)         | 2        |
| [Alpha 3 — Friction](https://us.posthog.com/project/610680/dashboard/2099056)                   | 6        |
| [Alpha 4 — Reliability](https://us.posthog.com/project/610680/dashboard/2099057)                | 8        |
| [Alpha 5 — D3 swap panel before/after](https://us.posthog.com/project/610680/dashboard/2099058) | 2        |
| [Alpha 6 — Scope drift](https://us.posthog.com/project/610680/dashboard/2099059)                | 2        |

What each one shows:

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

There is no session replay to fall back on, so T7 (free exploration) and any session with a rage
click or a `trigger_failed` have to be read from the event stream — `$autocapture`, `$dead_click`
and `error_shown` in _Activity → Live events_, filtered to that person.

## Setup

Done on 15 September 2026:

- **PostHog project settings:** replay and toolbar are limited to `https://beta.paiflow.xyz`,
  IPs are anonymized, inputs and text are masked, and exception and dead-click capture are on.
  Console-log capture, web vitals, surveys and heatmaps are off. The app
  itself also masks every text node in replays (`SESSION_RECORDING` in `lib/analytics/client.ts`).
  **Superseded 16 September: session replay is off entirely — see below.**
- **Railway `prod` environment** (beta.paiflow.xyz), service `pinkraft`:
  `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_APP_ENV=beta` are set. They take effect on the next
  build, because they're inlined at build time. `POSTHOG_HOST` defaults to US cloud, and
  `NEXT_PUBLIC_APP_VERSION` comes from `RAILWAY_GIT_COMMIT_SHA`.
- **Staging** (paiflow.xyz) has no PostHog variables and must stay that way.

### Superseded on 16 September 2026

The two bullets above describe the environment layout as it was, and are kept because they record
where the PostHog project settings came from. What is true now:

- The beta is **`beta.app.paiflow.xyz`**, served by the **staging** Railway service (`paiflow-app`)
  alongside `paiflow.xyz`. `beta.paiflow.xyz` is the static marketing site and has no app on it.
- The `prod` environment is **stopped**. Its `NEXT_PUBLIC_POSTHOG_KEY` and
  `NEXT_PUBLIC_APP_ENV=beta` went with it, which is why the round is currently untracked.
- "Staging has no PostHog variables and must stay that way" **no longer holds** — staging is now
  where the beta runs, so that is exactly where the variables have to go.
- **Session replay is off by decision (16 September 2026)** and is not coming back without a
  deliberate change. It never actually captured anything — zero `$snapshot` events were ever
  recorded — so nothing was lost. Three independent guards now hold it off: the project's
  `session_recording_opt_in` is `false`, `lib/analytics/client.ts` passes
  `disable_session_recording: true`, and the replay recorder is no longer bundled.
  `recording_domains` is deliberately left at `https://beta.app.paiflow.xyz` rather than emptied,
  because an empty list in PostHog means _every_ domain is allowed.
  `homepage/privacy.html` and `docs/alpha-testing-guide.md` both now state that we do not record;
  re-enabling replay means changing those first.

After the first beta build with this code, sign in with a test account, run T1, and check
_Activity → Live events_ for `builder_opened`, `deploy_confirmed` and `trigger_confirmed`.
