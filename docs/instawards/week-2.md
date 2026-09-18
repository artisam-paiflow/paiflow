# Week 2 — 14–20 September 2026

**Window:** 14–20 September 2026 · **Focus:** D2 — a developer API for the swapper

**Deliverable:** [D2 — Developer API](deliverables/d2.md) · **Evidence:** [transactions](evidence/README.md#transactions)

{% hint style="info" %}
Written on 17 September and updated on the 18th. The changelog below covers 14–17 September, which
is what the public mirror holds; it is regenerated again when the week closes.
{% endhint %}

## Summary

The developer API shipped: a partner's backend can now mint a token scoped to a single deployed
flow, ask the API to prepare an execution of it, sign that transaction with its own key, submit it
and poll the resulting on-chain events — no Soroban knowledge and no access to anything else in
the account. The API never signs, which is what keeps the app non-custodial. Two swaps ran through
that path on testnet on 18 September: one from the documented curl sequence, one from the Postman
collection. The alpha round opened on a beta hostname that runs
the same build as the public app, which meant moving the beta onto the staging service and keeping
the previous database as an archive the app no longer writes to. And every transaction the app
submits now records
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

| Date       | Change                                                                                               | Issues | Commit                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-18 | docs(instawards): report metrics on two bases, and count the alpha-tester cohort from PostHog        | #544   | [`00ce55b`](https://github.com/artisam-paiflow/paiflow/commit/00ce55b0dc8d45992edba77cb89f2055d842fd56) |
| 2026-09-17 | docs(alpha): record with the Loom desktop app, and correct what the guide promises testers           | #543   | [`f1184ba`](https://github.com/artisam-paiflow/paiflow/commit/f1184ba1532579095a7404911c2263855b6cec20) |
| 2026-09-17 | feat(analytics): wallet traceability in PostHog (promote #538)                                       | #540   | [`ceb1152`](https://github.com/artisam-paiflow/paiflow/commit/ceb1152602033dca728f47c04d7f0923f1d40d82) |
| 2026-09-17 | docs: say that the signing wallet's public address is recorded (promote #534)                        | #539   | [`533752d`](https://github.com/artisam-paiflow/paiflow/commit/533752dad08e1cd26b15f68efab7ed573c73b562) |
| 2026-09-17 | feat: persist the signing wallet for every submitted transaction                                     | #537   | [`ad31be1`](https://github.com/artisam-paiflow/paiflow/commit/ad31be1455838434a170002dba14f8b787c055da) |
| 2026-09-17 | fix(railway): stop declaring public TCP proxies on Postgres and Redis                                | #518   | [`2bb5db4`](https://github.com/artisam-paiflow/paiflow/commit/2bb5db4ed192e34bfcf634ef77590561319ea15a) |
| 2026-09-17 | fix(trigger): lock the trigger amount to what the flow actually consumes                             | #493   | [`e91b688`](https://github.com/artisam-paiflow/paiflow/commit/e91b6883d2fd5d95f0dea118cf5f62068d851910) |
| 2026-09-17 | fix(feed): label a RECEIVE with the asset entering the flow, not a swap's output                     | #492   | [`169944c`](https://github.com/artisam-paiflow/paiflow/commit/169944c2170ea6e5ee0f053db54f4048d8c45af7) |
| 2026-09-17 | fix(events): decode the root contract by its own kind and stamp the inbound asset                    | #491   | [`16ebff3`](https://github.com/artisam-paiflow/paiflow/commit/16ebff3c05e85d60b03ff09717eef57a808f612c) |
| 2026-09-17 | fix(cron): fail closed when CRON_SECRET is unset, and compare it in constant time                    | #516   | [`4b0564f`](https://github.com/artisam-paiflow/paiflow/commit/4b0564f7cf1b6f68fa1815d906821940c7181e90) |
| 2026-09-17 | fix(auth): judge the resolved origin, not the shape of the string                                    | #515   | [`bc888ec`](https://github.com/artisam-paiflow/paiflow/commit/bc888ec76e6504beab1150d2175f000309529b7a) |
| 2026-09-16 | fix(auth): stop the login form throwing on a relative callbackUrl                                    | #513   | [`103200f`](https://github.com/artisam-paiflow/paiflow/commit/103200fa6e39bf4987eb08af17a5432d81c371b7) |
| 2026-09-16 | fix(analytics): stop counting a navigation as a dropped live feed                                    | #510   | [`a01a580`](https://github.com/artisam-paiflow/paiflow/commit/a01a58094622181a21341571c30d261cda6491d1) |
| 2026-09-16 | fix(auth): sign out to a path, not to the container's own origin                                     | #511   | [`b3a6b57`](https://github.com/artisam-paiflow/paiflow/commit/b3a6b57c77508de7e587ef2e1f59068d3c2b2c57) |
| 2026-09-16 | fix(auth): let passkeys span hostnames so AUTH_URL can be unset                                      | #508   | [`2ada7f7`](https://github.com/artisam-paiflow/paiflow/commit/2ada7f7b0da963b4b646993d993a0d8e4e2994ed) |
| 2026-09-16 | docs(alpha): self-recorded interview round, and a rebuildable guide PDF                              | #506   | [`6d48246`](https://github.com/artisam-paiflow/paiflow/commit/6d48246d1919502ace8e6d895498843084b6a090) |
| 2026-09-16 | fix(homepage): point the CTAs at the beta app                                                        | #505   | [`0f889fe`](https://github.com/artisam-paiflow/paiflow/commit/0f889feb68f98981782888920a055ce4109b88fd) |
| 2026-09-16 | feat(analytics): stop recording sessions, and say so                                                 | #502   | [`90658e5`](https://github.com/artisam-paiflow/paiflow/commit/90658e58056ab5adcda80eefb99cf91e78354bc6) |
| 2026-09-16 | docs(instawards): point the metrics command at the archive, not the live database                    | #500   | [`e604942`](https://github.com/artisam-paiflow/paiflow/commit/e604942786fbb9067f7bb97cb6a534ae341fe5c3) |
| 2026-09-16 | docs: stop publishing admin credentials in the README                                                | #499   | [`c9456bf`](https://github.com/artisam-paiflow/paiflow/commit/c9456bffcb5449d169f0723dafd59a2ad1e41ab6) |
| 2026-09-16 | fix(scripts): finish the shell DATABASE_URL fix for upload and deploy-factory                        | #497   | [`cf8aeae`](https://github.com/artisam-paiflow/paiflow/commit/cf8aeae9a21ea05c31363f2da377210814c8df71) |
| 2026-09-16 | docs(analytics): describe the beta as it is after moving to staging                                  | #496   | [`4e01b6f`](https://github.com/artisam-paiflow/paiflow/commit/4e01b6fae328258210393576c7ff7bdaee09bcc6) |
| 2026-09-16 | fix(homepage): point the marketing-page redirects at the host that serves them                       | #495   | [`2ca9fe9`](https://github.com/artisam-paiflow/paiflow/commit/2ca9fe917a32f6776f0643f2e68b9ca7925c6bee) |
| 2026-09-16 | fix(scripts): let a shell DATABASE_URL reach the hash-sync scripts                                   | #494   | [`b4af5c1`](https://github.com/artisam-paiflow/paiflow/commit/b4af5c1d4a19a7a94d2e4c821da82b0457552fbd) |
| 2026-09-16 | fix(railway): move service config to .railway/railway.ts; drop root railway.toml                     | —      | [`3a44e9c`](https://github.com/artisam-paiflow/paiflow/commit/3a44e9c503bd719c0037c47b958c8f2b5eb17514) |
| 2026-09-15 | fix(analytics): forward Origin through /ingest, count poll-delivered feed rows                       | #489   | [`6bb793b`](https://github.com/artisam-paiflow/paiflow/commit/6bb793bf18852f3110354120971c7a85a705268b) |
| 2026-09-15 | feat(analytics): PostHog tracking for the alpha round on beta.paiflow.xyz                            | #488   | [`8434358`](https://github.com/artisam-paiflow/paiflow/commit/84343589514033a046d6e8699c573a79445b1040) |
| 2026-09-15 | fix(events): follow the RPC cursor so a quiet deployment's poller reaches the tip                    | #483   | [`6f4bf80`](https://github.com/artisam-paiflow/paiflow/commit/6f4bf806ac747eb916c5a51f0923efff8cf98690) |
| 2026-09-15 | docs: add the alpha testing guide, pointed at beta.paiflow.xyz                                       | #485   | [`d8f6c0a`](https://github.com/artisam-paiflow/paiflow/commit/d8f6c0ad5bc5a0155cabe5f45494235a0eb2086b) |
| 2026-09-15 | docs(api): OpenAPI spec, Postman collection and developer guide for /api/v1                          | #470   | [`01368ba`](https://github.com/artisam-paiflow/paiflow/commit/01368ba0f055a399a1dc691d3f480e6da5b6d3fd) |
| 2026-09-15 | feat(api): execute a swapper flow through /api/v1 (prepare + submit)                                 | #468   | [`27b6ed9`](https://github.com/artisam-paiflow/paiflow/commit/27b6ed9cccb741ca3780217f51f4a1a0037306df) |
| 2026-09-15 | feat(homepage): move the marketing pages into a static homepage/ site                                | #479   | [`2d317ce`](https://github.com/artisam-paiflow/paiflow/commit/2d317ce3b57bbcb26e2fa096484b9730d0908ff1) |
| 2026-09-15 | feat(api): cursor-based event polling at GET /api/v1/deployments/{id}/events                         | #469   | [`7f1f6fb`](https://github.com/artisam-paiflow/paiflow/commit/7f1f6fb947a1de595af384263b481fb20365a726) |
| 2026-09-14 | feat(api): let a deployment owner mint, list and revoke API tokens                                   | #467   | [`c3cc445`](https://github.com/artisam-paiflow/paiflow/commit/c3cc4454bc18d16c9e0713fc77c51f5516bd92be) |
| 2026-09-14 | feat(api): add the /api/v1 primitives: deployment-token auth, token-keyed rate limits, audit actions | #466   | [`a06377b`](https://github.com/artisam-paiflow/paiflow/commit/a06377b4228e9fbc9173c4d1919dcc9f7cb86c7a) |

Two of the 15 September rows name `beta.paiflow.xyz`. That was the hostname assumed for the alpha
round before the 16 September cutover; the app is at `beta.app.paiflow.xyz` and `beta.paiflow.xyz`
serves the static marketing site. The rows are reproduced as the pull requests were titled, so the
record of what was merged stays intact — see the [metrics page](metrics.md#counting-rules) for the
layout as it is now.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                | Deliverable              | Status    | Evidence                                                                                                                   |
| --------------------------------------------------------- | ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| Extract reusable auth, rate limiting and audit primitives | [D2](deliverables/d2.md) | Done      | `lib/api/v1/handler.ts`, nine test suites                                                                                  |
| Deployment-scoped API tokens                              | [D2](deliverables/d2.md) | Done      | [access panel](evidence/d2/api-access-panel.png)                                                                           |
| `POST /api/v1/deployments/{id}/execute`                   | [D2](deliverables/d2.md) | Evidenced | [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7) |
| `GET /api/v1/deployments/{id}/events`                     | [D2](deliverables/d2.md) | Evidenced | [events response](evidence/d2/05-events-response.json)                                                                     |
| Unit and integration tests                                | [D2](deliverables/d2.md) | Done      | Green in CI                                                                                                                |
| OpenAPI specification and Postman collection              | [D2](deliverables/d2.md) | Done      | [`openapi.json`](../api/openapi.json)                                                                                      |
| API documentation with curl examples                      | [D2](deliverables/d2.md) | Done      | [Developer guide](../api/README.md)                                                                                        |
| Authenticated curl requests execute a swapper flow        | [D2](deliverables/d2.md) | Evidenced | [transcript](evidence/d2/01-curl-transcript.md)                                                                            |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

## Evidence added

| Item                                                  | Type             | Link                                                                                                                       |
| ----------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API access panel                                      | Screenshot       | [`d2/api-access-panel.png`](evidence/d2/api-access-panel.png)                                                              |
| OpenAPI specification                                 | Artefact         | [`openapi.json`](../api/openapi.json)                                                                                      |
| Postman collection                                    | Artefact         | [collection](../api/paiflow-api-v1.postman_collection.json)                                                                |
| Alpha-tester cohort                                   | Definition       | [`alpha-testers.json`](evidence/alpha-testers.json)                                                                        |
| First alpha-tester metrics snapshot                   | Metrics          | [`alpha-metrics-2026-09-17.json`](evidence/alpha-metrics-2026-09-17.json)                                                  |
| API-executed swap, 10 XLM → 1.0584167 USDC            | Transaction hash | [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7) |
| curl transcript: prepare → local sign → submit        | API sample       | [`01-curl-transcript.md`](evidence/d2/01-curl-transcript.md)                                                               |
| Prepare and submit responses                          | API sample       | [`02`](evidence/d2/02-prepare-response.json), [`03`](evidence/d2/03-submit-response.json)                                  |
| Raw `getTransaction` for the swap                     | RPC record       | [`04-getTransaction.json`](evidence/d2/04-getTransaction.json)                                                             |
| Audit rows: prepared, submitted, confirmed (redacted) | Audit log        | [`06-audit-rows.json`](evidence/d2/06-audit-rows.json)                                                                     |
| The OpenAPI document as served by paiflow.xyz         | API sample       | [`08-openapi.json`](evidence/d2/08-openapi.json)                                                                           |

All five of D2's §6.1 evidence items are present, from two runs on 18 September. The documented
curl sequence executed a swap ([`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7), 10 XLM → 1.0584167 USDC) with its
events response and audit rows; importing the Postman collection and driving it end to end executed
a second ([`27f68188…`](https://stellar.expert/explorer/testnet/tx/27f681889bfebdab92a4d9e6d70770ea5df72bd597c627bc5c0014d0d86bfbfb), 1 XLM → 0.1055731 USDC), so the collection is evidenced by a
transaction rather than only a screenshot. **D2 is complete and closed.**

The 15 September swap is kept in the [evidence index](evidence/README.md#transactions) but could
not supply the events response: its deployment, token and event rows are in the database the public
app used until 16 September, kept as an archive the app no longer writes to.

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
the database the public app used until 16 September, an archive the app no longer writes to, so its
figures cannot change. New activity lands in the live beta database and is reported on the
alpha-tester basis instead.

That basis produced its first numbers on 17 September. Three tester accounts have been issued against
a planned five, and one tester has been through a session: 11 flows deployed, 19 transactions signed
across 3 distinct wallets, and 2 swapper flows executed. It is one session's worth of work, and the
[metrics page](metrics.md) labels it as such rather than presenting it as the round's total.

## Decisions

**No blockers to the deliverable.** D2's code is merged and running on the public app, two swaps
have been executed through the API on testnet, and every evidence item the SOW asks for is
present. D2 is closed.

- **Eight deliberate differences from the SOW's wording.** Execute is two calls and the partner
  signs; new deployment-scoped tokens instead of the payroll credentials; a route-handler wrapper
  instead of edge middleware; execute runs the flow's deposit trigger; rate limits keyed on the
  token; events read from the app's own record; a hand-authored OpenAPI document; reviewers read
  the API path rather than drive it anonymously. Each is recorded with its reason and how to
  verify it in the [D2 scope notes](deliverables/d2.md#scope-notes), without editing the SOW.
- **A risk the SOW's table does not list: the developer API itself.** Section 3.9 has no row for
  it, so it is added here.

  | Risk                                                                                       | Mitigation                                                                                                                                                                                                                  |
  | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A leaked API token is used to act on a flow                                                | Tokens are bound to one deployment, stored only as a hash, shown once, revocable from the deployment page with effect on the next request, and optionally expiring. The API never signs, so a token alone cannot move funds |
  | A token is used to submit an arbitrary signed transaction under a deployment's audit trail | `execute/submit` parses the envelope and refuses anything but a single `deposit` on that deployment's trigger contract                                                                                                      |
  | Rate limits are evaded by spoofing the client IP                                           | Every `/api/v1` limit is keyed on the token id, not the forwarded IP                                                                                                                                                        |

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

D3, the reusable builder input components. D2 is closed. The alpha round runs alongside: two issued accounts have yet to run a
session, and two more accounts have yet to be issued. A tester joins the cohort file when their
account is issued, not when their session finishes, so the next snapshot picks up each newly active
tester without the file having to change.
