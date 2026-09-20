# Alpha round — analytics tracking plan

What PostHog records during the alpha round, why, and how to read it. The code is
`lib/analytics/`; the event catalog `lib/analytics/events.ts` is the source of truth for names
and properties, so this page describes intent and doesn't restate every field.

## Scope and rules

- **Where:** the beta is `beta.app.paiflow.xyz`. Analytics is on only when the build has
  `NEXT_PUBLIC_POSTHOG_KEY`; local dev and tests load nothing.

  > **On again since 16 September**, verified against a real run that afternoon. The beta shares
  > the **staging** Railway service with `paiflow.xyz` — one service, one build, one database — so
  > the variables now live on `staging`, where they had previously been forbidden. They are inlined
  > at build time, which makes "is it on?" a question about the **running build**, not about the
  > service's variables:
  >
  > ```bash
  > # 1. the key the running build actually sends from
  > KEY=$(curl -fsS https://beta.app.paiflow.xyz/login \
  >   | grep -o '/_next/static/chunks/app/layout-[^"]*\.js' | head -1 \
  >   | xargs -I{} curl -fsS "https://beta.app.paiflow.xyz{}" \
  >   | grep -o 'phc_[A-Za-z0-9]*')
  > echo "${KEY:-no key found - check stderr before concluding the build has none}"
  >
  > # 2. the runtime proxy, once you have a key to ask about
  > [ -n "$KEY" ] && curl -sS -o /dev/null -w '%{http_code}\n' \
  >   "https://beta.app.paiflow.xyz/ingest/array/$KEY/config"
  > ```
  >
  > The first is the one that actually settles it: it reads the key out of the chunk the browser
  > loads, which is where `lib/analytics/client.ts` gets it — an inlined `process.env` value. Resolve
  > that chunk through the served HTML; asking for `layout-*.js` directly does not work, because the
  > `*` is a shell glob over local files and travels to the server as a literal path that 404s
  > whatever the build contains. Use `/login` rather than `/`, which redirects and carries no chunk
  > reference. Keep `-fS` on both fetches: a silently failed request reads as an empty result,
  > which is the same false negative in a different disguise.
  >
  > The second confirms the server half: `app/ingest/[...path]/route.ts` 404s when the service has
  > no `NEXT_PUBLIC_POSTHOG_KEY`, so a `200` means both halves agree. A 404 on its own is ambiguous
  > — PostHog upstream also 404s a key it doesn't recognise. Setting the variables without a
  > **rebuild** leaves this check passing and the first one empty.
  >
  > One build now serves both hostnames, so this turned analytics on for `paiflow.xyz` too, and
  > `app_env` can no longer separate the two: filter on `$host` instead.

- **Who:** testers are `app_env = beta` events from people whose `role` isn't `ADMIN`. Every
  dashboard insight applies both filters. Since the two hostnames share one build, `app_env` alone
  no longer isolates the beta. Until `$host = beta.app.paiflow.xyz` is added, `paiflow.xyz`
  visitors are counted as testers — and analytics is on, so that is happening now.
- **Identity:** `distinct_id` is `User.id`. Usernames, emails, recipient addresses, XDR and
  graph JSON are never sent. `lib/analytics/sanitize.ts` redacts StrKeys, seeds, base64 blobs,
  app-minted credentials (`pfk_`, `whsec_`, JWTs, sign-in tickets, `?token=` values) and email
  addresses from every property, including autocaptured element text; the one-time API token
  panel is `ph-no-capture`, so it is not captured at all. One deliberate exception: the
  **signing wallet's own public address**, on the named properties under
  [Wallet traceability](#wallet-traceability). Asked for on 17 September 2026 so a testnet
  transaction can be traced back to a tester inside PostHog as well as in the database. The
  tester guide, its PDF and `homepage/privacy.html` were changed to say so before any event
  carried an address.
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
lag is only meaningful for `source = sse`. Both come from the deployment page, so a tester who
triggers from `/trigger/:id` and never returns produces none of them — absence there is not a
broken feed.

`live_feed_disconnected` is sent from the **reconnect attempt**, five seconds after the drop, not
from the error itself (`components/deploy/deployment-view.tsx`). Leaving the page aborts the stream
and raises the same error, and `pagehide` arrives _after_ it, so the guard that used to sit there
could not tell a real drop from a navigation: the 16 September run sent one 4ms ahead of posthog's
own `$pageleave`. Reading the series: a drop the viewer left within five seconds of is not counted,
which undercounts rather than inflates. **Counts from before 16 September 2026 include one false
positive per navigation away from a deployment page** and are not comparable with later ones.

Server-side events carry `source = server`. `deploy_confirmed` is attributed to the deployer;
`trigger_confirmed`, `trigger_failed_onchain` and `transaction_signed` to the **signer** recorded at
submit (their user, or `wallet:G…` with no person profile), falling back to the deployment owner
only for transactions from before signers were recorded.
Autocapture (clicks, including stellar.expert links), rage and dead clicks, `$pageview` and
`$exception` come from posthog-js itself. **Session replay is off** — see Setup.

## Wallet traceability

Which wallet signed which transaction, under which app account. The database is the system of
record and PostHog carries the same three facts so they can be read in one place with the funnel.

**Database.** `SignedTransaction` (see `lib/signed-tx.ts`) holds one row per envelope the app
submitted: `txHash`, `signerAddress` (always the `G…` form, read from the signed envelope's source
account, not from what the client claimed), `userId`, `deploymentId`, `kind` (`DEPLOY`, `TRIGGER`,
`INVOKE`, `API_EXECUTE`) and `network`. `userId` is the **signer's** session user; it is null for
an anonymous signer on the public trigger page and for the partner API, and the deployment's owner
is never substituted. `GET /api/admin/signed-transactions?address=|userId=|deploymentId=|txHash=`
answers, in order: the user behind a wallet, a user's wallets, and both for one transaction.

**PostHog.** The address travels on named properties only:

| Property               | Where                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_address`       | `wallet_connect_succeeded` (browser, every surface); person property = most recent wallet                                                 |
| `wallet_address_first` | person property, set once                                                                                                                 |
| `signer_address`       | `deploy_confirmed` (with the new `tx_hash`), `trigger_succeeded`, `trigger_confirmed`, `trigger_failed_onchain`, and `transaction_signed` |

`transaction_signed` is captured **server-side** from the same code path that writes the database
row, once per hash (a resubmitted envelope adds neither a row nor an event), so it covers the payroll and contract-call panels (which emit no browser events), anonymous
signers, and browsers with an ad blocker. Its `distinct_id` is the signer's `User.id` when known,
otherwise `wallet:G…` with `$process_person_profile: false`, so anonymous signers never become
PostHog persons.

The three questions inside PostHog:

- **user → wallets:** `transaction_signed`, break down by `signer_address`, filter
  `distinct_id = <User.id>`.
- **wallet → user:** the same event filtered `signer_address = G…`, broken down by person.
- **tx hash → both:** Activity, filter `tx_hash = …`.

Caveats. A person property holds one value, so `wallet_address` is the **latest** wallet, not the
only one — the event breakdown is the complete list. An anonymous trigger-page signer has no
person profile, so for them the answer lives on event properties only. And `signer_address` is
strong evidence, not proof: it is the envelope's source account, which a multisig account could
make differ from the key that signed.

The mechanism is an allowlist in `lib/analytics/sanitize.ts`: exactly those property names may
carry a value that **is** a `G…` address (anchored; a seed, an XDR blob, a contract address or a
sentence containing an address is dropped, not sent). Every other property keeps the full
redaction, including autocaptured element text.

## Dashboards

Built in the dedicated PostHog project **Paiflow beta** (US cloud, id 610680). Keep Paiflow data
there: don't reuse another product's project key. Every insight filters to `app_env = beta` and
excludes people with `role = ADMIN`, so your own check runs don't count as testers. There's also a
cohort, _Alpha testers_ (`role = USER`).

Both filters were written when the beta had a build of its own, and analytics is on again without
them having been updated — see **Scope and rules**. Until `$host = beta.app.paiflow.xyz` is added,
every insight and the _Alpha testers_ cohort counts `paiflow.xyz` traffic as tester activity; the
16 September check found 19 `$pageview` from that host inside a single two-hour window.

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
   _Coverage by tester_ has one column per kind of test rather than per test number, because the
   guide was renumbered on 19 September: `swap_deploys` (T1; T1/T2 for testers 1–2), `pay_deploys`
   (T3; was T4 — a `PAYER` deploy with no swap in it), `split_deploys` (T4/T5; was T5/T6) and
   `api_tokens_created` (T6, new). T6 deploys nothing, so it is read from
   `off_script_feature_used` with `feature = api_token_created`, from 19 September onwards.
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
   testers in, hide it rather than asking testers not to use it. Both insights leave out
   `feature = api_token_created` from 19 September, when the guide's T6 started asking testers to
   create a token; it is counted on _Test-case coverage_ instead. Token creations before that date
   were off-script and still show here. The app still sends the event under this name — renaming
   it mid-round would split the series.

There is no session replay to fall back on, so T7 (free exploration) and any session with a rage
click or a `trigger_failed` have to be read from the event stream — `$autocapture`, `$dead_click`
and `error_shown` in _Activity → Live events_, filtered to that person.

## Group B (quick test)

A second, lighter group follows `docs/alpha-testing-guide-lite.md`: no Loom, no wallet in the core
session, answers in a Google Form (`docs/user-feedback-survey.md`, "Group B"). With no recording,
the event stream is the only record of what a group B tester did, so it matters more here than for
group A.

What to read, per tester, filtered to that account's `distinct_id`:

- **Did they get there, and how fast:** `builder_opened` → `deploy_review_viewed` on the flow named
  _Shop_. `deploy_review_viewed` fires when the review page loads and needs no wallet, so it is the
  finish line of task B3. The time between the two is the measured version of the survey's
  self-reported minutes.
- **What got in the way:** `validation_error_appeared` by `error_key` between those two events,
  with `validation_error_resolved.time_to_resolve_ms`; `node_added` / `node_removed` show whether
  they edited the example or deleted it and started again.
- **Guided against unguided:** B3 is group A's T4 (a two-way XLM split) without the steps. The same
  `error_key`s, compared across the two groups, show what the written steps were papering over.

Four things that will look wrong on the dashboards and aren't:

- **Task B1 emits nothing at all.** It happens on `beta.paiflow.xyz` before the tester signs in, and
  that host is the static marketing site — it has no app on it and no analytics in it. A group B
  tester's first event is `login_succeeded`, so the ten seconds the survey asks about exist only in
  their answers to questions 2–4.
- Group B accounts are `role = USER`, so they appear on Alpha 1–6 next to group A. **On _Alpha 1 —
  Tester funnel_ they drop out at `deploy_confirmed` by design**; only a tester who does the
  optional bonus deploys. Read group B by an explicit `distinct_id` list, the way
  `scripts/alpha-metrics.ts` reads group A.
- They never appear on _Alpha 2 — Test-case coverage_ as anything but a row of zeros, unless they
  do the bonus, which shows as one `split_deploys`.
- Task B4 is done on a phone with no session, so its `trigger_page_viewed` and
  `deployment_page_viewed` arrive under an anonymous `distinct_id` and cannot be tied to a tester.
  Those answers exist only in the survey.

Group B is not in `docs/instawards/evidence/alpha-testers.json`. When the accounts are issued, list
them in a cohort file of their own and pass it with `--cohort=`; a bonus deployer's wallet then
counts toward "distinct wallets deploying" only on that basis, stated as such.

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
  `NEXT_PUBLIC_APP_ENV=beta` went with it, which left the round untracked for part of 16 September.
- "Staging has no PostHog variables and must stay that way" **no longer holds** — staging is where
  the beta runs, so that is exactly where the variables have to go, and where they now are
  (`paiflow-app`, both baked into the build that serves both hostnames).
- **Session replay is off by decision (16 September 2026)** and is not coming back without a
  deliberate change. It never actually captured anything — zero `$snapshot` events were ever
  recorded — so nothing was lost. Three independent guards now hold it off: the project's
  `session_recording_opt_in` is `false`, `lib/analytics/client.ts` passes
  `disable_session_recording: true`, and the replay recorder is no longer bundled.
  `recording_domains` is deliberately left at `https://beta.app.paiflow.xyz` rather than emptied,
  because an empty list in PostHog means _every_ domain is allowed.
  `homepage/privacy.html` and `docs/alpha-testing-guide.md` both now state that we do not record;
  re-enabling replay means changing those first.

Verified this way on 16 September 2026: a trigger run on `beta.app.paiflow.xyz` produced
`builder_opened`, `deployment_page_viewed`, `trigger_page_viewed`, `trigger_started`,
`wallet_connect_succeeded`, the server's `trigger_confirmed` and the client's `trigger_succeeded`,
sharing one `tx_hash` and one `deployment_id`. `distinct_id` was the `User.id` on both client and
server events, the person carried `role`, `amount_stroops` was a string, and a scan of all 45
events — `$autocapture` element text included — found no StrKey, seed or XDR blob, with `$ip` null
throughout. Repeat that check after any change to `lib/analytics/`.
