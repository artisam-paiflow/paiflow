# Week 2 — 14–20 September 2026

**Window:** 14–20 September 2026 · **Focus:** D2 — a developer API for the swapper

**Deliverable:** [D2 — Developer API](deliverables/d2.md) · **Evidence:** [transactions](evidence/README.md#transactions)

{% hint style="info" %}
Written on 17 September, mid-week. The changelog below covers 14–16 September, which is what the
public mirror holds; it is regenerated when the week closes.
{% endhint %}

## Summary

The developer API shipped: a partner's backend can now mint a token scoped to a single deployed
flow, execute that flow with one HTTP request, and poll its on-chain events — no wallet integration
and no access to anything else in the account. The alpha round opened on a beta hostname that runs
the same build as the public app, which meant moving the beta onto the staging service and keeping
the previous database as a read-only archive. And every transaction the app submits now records
which wallet signed it, so a deployment, a user and an on-chain hash can be tied together after the
fact.

The plan changed in one respect, described under [Decisions](#decisions): the success metrics are
now reported on two bases, because the existing figures turned out to measure sandbox visitors
rather than identified users.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-14 --until 2026-09-20 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                            | Issues | Commit                                                                                                  |
| ---------- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-16 | feat(analytics): stop recording sessions, and say so                              | #502   | [`90658e5`](https://github.com/artisam-paiflow/paiflow/commit/90658e58056ab5adcda80eefb99cf91e78354bc6) |
| 2026-09-16 | docs(instawards): point the metrics command at the archive, not the live database | #500   | [`e604942`](https://github.com/artisam-paiflow/paiflow/commit/e604942786fbb9067f7bb97cb6a534ae341fe5c3) |
| 2026-09-16 | docs: stop publishing admin credentials in the README                             | #499   | [`c9456bf`](https://github.com/artisam-paiflow/paiflow/commit/c9456bffcb5449d169f0723dafd59a2ad1e41ab6) |
| 2026-09-16 | fix(scripts): finish the shell DATABASE_URL fix for upload and deploy-factory     | #497   | [`cf8aeae`](https://github.com/artisam-paiflow/paiflow/commit/cf8aeae9a21ea05c31363f2da377210814c8df71) |
| 2026-09-16 | docs(analytics): describe the beta as it is after moving to staging               | #496   | [`4e01b6f`](https://github.com/artisam-paiflow/paiflow/commit/4e01b6fae328258210393576c7ff7bdaee09bcc6) |
| 2026-09-16 | fix(homepage): point the marketing-page redirects at the host that serves them    | #495   | [`2ca9fe9`](https://github.com/artisam-paiflow/paiflow/commit/2ca9fe917a32f6776f0643f2e68b9ca7925c6bee) |
| 2026-09-16 | fix(scripts): let a shell DATABASE_URL reach the hash-sync scripts                | #494   | [`b4af5c1`](https://github.com/artisam-paiflow/paiflow/commit/b4af5c1d4a19a7a94d2e4c821da82b0457552fbd) |
| 2026-09-16 | fix(railway): move service config to .railway/railway.ts; drop root railway.toml  | —      | [`3a44e9c`](https://github.com/artisam-paiflow/paiflow/commit/3a44e9c503bd719c0037c47b958c8f2b5eb17514) |
| 2026-09-15 | fix(analytics): forward Origin through /ingest, count poll-delivered feed rows    | #489   | [`6bb793b`](https://github.com/artisam-paiflow/paiflow/commit/6bb793bf18852f3110354120971c7a85a705268b) |
| 2026-09-15 | feat(analytics): PostHog tracking for the alpha round on beta.paiflow.xyz         | #488   | [`8434358`](https://github.com/artisam-paiflow/paiflow/commit/84343589514033a046d6e8699c573a79445b1040) |
| 2026-09-15 | fix(events): follow the RPC cursor so a quiet deployment's poller reaches the tip | #483   | [`6f4bf80`](https://github.com/artisam-paiflow/paiflow/commit/6f4bf806ac747eb916c5a51f0923efff8cf98690) |
| 2026-09-15 | docs: add the alpha testing guide, pointed at beta.paiflow.xyz                    | #485   | [`d8f6c0a`](https://github.com/artisam-paiflow/paiflow/commit/d8f6c0ad5bc5a0155cabe5f45494235a0eb2086b) |
| 2026-09-15 | docs(api): OpenAPI spec, Postman collection and developer guide for /api/v1       | #470   | [`01368ba`](https://github.com/artisam-paiflow/paiflow/commit/01368ba0f055a399a1dc691d3f480e6da5b6d3fd) |
| 2026-09-15 | feat(api): execute a swapper flow through /api/v1 (prepare + submit)              | #468   | [`27b6ed9`](https://github.com/artisam-paiflow/paiflow/commit/27b6ed9cccb741ca3780217f51f4a1a0037306df) |
| 2026-09-15 | feat(homepage): move the marketing pages into a static homepage/ site             | #479   | [`2d317ce`](https://github.com/artisam-paiflow/paiflow/commit/2d317ce3b57bbcb26e2fa096484b9730d0908ff1) |
| 2026-09-15 | feat(api): cursor-based event polling at GET /api/v1/deployments/{id}/events      | #469   | [`7f1f6fb`](https://github.com/artisam-paiflow/paiflow/commit/7f1f6fb947a1de595af384263b481fb20365a726) |
| 2026-09-14 | feat(api): let a deployment owner mint, list and revoke API tokens                | #467   | [`c3cc445`](https://github.com/artisam-paiflow/paiflow/commit/c3cc4454bc18d16c9e0713fc77c51f5516bd92be) |

Two of the 15 September rows name `beta.paiflow.xyz`. That was the hostname assumed for the alpha
round before the 16 September cutover; the app is at `beta.app.paiflow.xyz` and `beta.paiflow.xyz`
serves the static marketing site. The rows are reproduced as the pull requests were titled, so the
record of what was merged stays intact — see the [metrics page](metrics.md#counting-rules) for the
layout as it is now.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                | Deliverable              | Status      | Evidence                                         |
| --------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------ |
| Extract reusable auth, rate limiting and audit primitives | [D2](deliverables/d2.md) | Done        | `lib/api/v1/handler.ts`, nine test suites        |
| Deployment-scoped API tokens                              | [D2](deliverables/d2.md) | Done        | [access panel](evidence/d2/api-access-panel.png) |
| `POST /api/v1/deployments/{id}/execute`                   | [D2](deliverables/d2.md) | Done        | Live on the public app                           |
| `GET /api/v1/deployments/{id}/events`                     | [D2](deliverables/d2.md) | Done        | Live on the public app                           |
| Unit and integration tests                                | [D2](deliverables/d2.md) | Done        | Green in CI                                      |
| OpenAPI specification and Postman collection              | [D2](deliverables/d2.md) | Done        | [`openapi.json`](../api/openapi.json)            |
| API documentation with curl examples                      | [D2](deliverables/d2.md) | In progress | Guide written; samples not yet captured live     |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

## Evidence added

| Item                                | Type       | Link                                                                      |
| ----------------------------------- | ---------- | ------------------------------------------------------------------------- |
| API access panel                    | Screenshot | [`d2/api-access-panel.png`](evidence/d2/api-access-panel.png)             |
| OpenAPI specification               | Artefact   | [`openapi.json`](../api/openapi.json)                                     |
| Postman collection                  | Artefact   | [collection](../api/paiflow-api-v1.postman_collection.json)               |
| Alpha-tester cohort                 | Definition | [`alpha-testers.json`](evidence/alpha-testers.json)                       |
| First alpha-tester metrics snapshot | Metrics    | [`alpha-metrics-2026-09-17.json`](evidence/alpha-metrics-2026-09-17.json) |

D2's §6.1 evidence is not complete: an API-triggered transaction hash, live curl samples and the
matching audit row are still outstanding, and they come from a run on the public app rather than
from more code.

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | At end of week 2 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    | 26               | —      |
| Contract executions / events  | ≥ 60   | 61               | —      |
| Unique swapper flows executed | ≥ 5    | 16               | —      |
| Distinct deploying wallets    | ≥ 6    | 7                | —      |
| Contract WASM uploaded        | ≥ 1    | 1                | —      |

Every figure is unchanged from 12 September, and that is expected rather than a stall: these count
the database the public app used until 16 September, which has been a frozen read-only archive since
the switch. New activity lands in the live beta database and is reported on the alpha-tester basis
instead.

That basis produced its first numbers on 17 September. Three tester accounts have been issued against
a planned five, and one tester has been through a session: 11 flows deployed, 19 transactions signed
across 3 distinct wallets, and 2 swapper flows executed. It is one session's worth of work, and the
[metrics page](metrics.md) labels it as such rather than presenting it as the round's total.

## Decisions

**No blockers to the deliverable.** D2's code is merged and running on the public app; only its
evidence capture is outstanding.

- **The success metrics are now reported on two bases.** Checking what the published numbers
  actually counted showed they were almost entirely disposable sandbox sessions and the project's
  own accounts — 19 users in the 12 September snapshot, 17 of them `SANDBOX` rows, leaving `admin`
  and `judge`; and of the 16 executed swapper flows, 13 were sandbox visitors. Rather than restate
  them, the [metrics page](metrics.md) now carries an all-activity column and an alpha-tester
  column. The first measures reach, the second measures depth, and neither is a correction of the
  other.
- **Alpha-tester figures are counted from PostHog, not the database.** The database cannot separate
  one user from another without a cohort marker it does not have, and the live beta database has no
  public endpoint. PostHog identifies per person. The five testers are listed by `User.id` in
  [`evidence/alpha-testers.json`](evidence/alpha-testers.json) and every query filters on that list;
  PostHog's own `role = USER` cohort is not used, because since the cutover it also matches ordinary
  `paiflow.xyz` visitors. The file is pseudonymous — no name, username or email.
- **The beta moved onto the staging service.** Both hostnames are now served by one Railway service
  running one build, because giving the beta its own service would have required a DNS change we
  cannot make. The database behind that service was swapped, and the previous Postgres kept alive as
  `postgres-staging-archive` — every committed metrics snapshot was taken against what is now the
  archive.
- **The signing wallet is recorded in full, not hashed.** A signer's public address is written to
  the database and carried on analytics events, so a transaction can be traced to a wallet and,
  where there was a session, to a user. Public addresses are already public; a secret key is never
  touched. Session replay was turned off in the same week.

## Issues found and fixed

- **A successful deploy could be submitted twice.** The status flip is now claimed atomically
  before submission.
- **A signature was verified by its four-byte hint rather than the signature itself**, which is a
  weaker check than it appeared; the source signature is now verified properly.
- **An open redirect on the login callback** (#515) — the post-login destination is fixed rather
  than taken from a parameter, and the resolved origin is judged instead of the shape of the string.
- **Cron routes failed open when `CRON_SECRET` was unset.** Under production they now refuse every
  request and compare the secret in constant time. Several of these routes sign with the relayer key.
- **Admin credentials were published in the README** and have been removed.
- **A navigation was counted as a dropped live feed**, overstating the disconnect metric.

## Planned maintenance

The factory's contract instance was extended on 13 September to ledger 7756749, roughly 12 March
2027, and needs the same again before then; it is one of eight contracts with no `extend_ttl` call
of its own. `pnpm contracts:extend-ttl --network=testnet` reports the current figures. Defect #459
— a deploy whose WASM entry has already archived still simulates successfully, so the user is asked
to sign a transaction that cannot land — remains open.

## Next week

D3, the reusable builder input components, plus the evidence capture D2 still owes: an API-triggered
swap with its transaction hash, curl samples against a live token, and the audit row that proves the
execution was recorded. The alpha round runs alongside: two issued accounts have yet to run a
session, and two more accounts have yet to be issued. A tester joins the cohort file when their
account is issued, not when their session finishes, so the next snapshot picks up each newly active
tester without the file having to change.
