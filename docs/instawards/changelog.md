# Full changelog

Every change merged during the Instawards sprint, newest week first. Each week's table is also
reproduced in that week's report. Commit links open on the public repository.

Generated with `pnpm instawards:changelog` — see [week 1](week-1.md) for the exact invocation.

## Week 2 — 14–20 September 2026

D2: a developer API for the swapper — deployment-scoped tokens, an execute endpoint and cursor-based
event polling. The beta also moved onto the staging service and the alpha round opened. Reported in
full in [week 2](week-2.md).

Covers 14–16 September, the extent of the public mirror when this was generated on 17 September; it
is regenerated when the week closes.

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

## Week 1 — 7–13 September 2026

D1: the swapper executes a real swap through the Soroswap testnet router. Reported in full in
[week 1](week-1.md).

| Date       | Change                                                                                      | Issues | Commit                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | Merge pull request #458 from webnxt-2030/chore/bump-simplewebauthn-14                       | #458   | [`c424958`](https://github.com/artisam-paiflow/paiflow/commit/c424958496fa92d132e54d839306661052c1392e) |
| 2026-09-12 | chore(deps): bump vitest to 4.1.11                                                          | #457   | [`55ac6ed`](https://github.com/artisam-paiflow/paiflow/commit/55ac6edc3d0e36ee77409efba309bede1d73e682) |
| 2026-09-12 | chore(deps): bump next to 15.5.25 and next-auth to beta.32                                  | #445   | [`ccdaa9f`](https://github.com/artisam-paiflow/paiflow/commit/ccdaa9fc2245d153720a23bac0d95aae995c08de) |
| 2026-09-12 | chore(deps): refresh stale pnpm overrides and pin transitive advisories                     | #444   | [`5214f21`](https://github.com/artisam-paiflow/paiflow/commit/5214f21bf9eb61606a0e44b3be516a01ff2ad618) |
| 2026-09-11 | docs(instawards): group the week report by decision, fix and maintenance                    | #449   | [`f56fb4c`](https://github.com/artisam-paiflow/paiflow/commit/f56fb4c39ee32fb8866536148628df5d6386f08e) |
| 2026-09-11 | docs(instawards): separate the two SOW narrowings from the choices it leaves open           | #443   | [`fd1b594`](https://github.com/artisam-paiflow/paiflow/commit/fd1b594b2a9116f5e8ec4a94b23676942a1b844c) |
| 2026-09-11 | docs(instawards): evidence table first on the D1 page, embedded captures, anchored links    | #441   | [`4430193`](https://github.com/artisam-paiflow/paiflow/commit/44301930815f6f144d86326c89ad2097f5cf56db) |
| 2026-09-11 | docs(instawards): D1 screen recording, executed swapper flows, and the 11 September metrics | #440   | [`2e7d72c`](https://github.com/artisam-paiflow/paiflow/commit/2e7d72c3e1713ec1a4eaa7515c5c4b79a42f6bd8) |
| 2026-09-11 | fix(sandbox): point the swap starter at a different funded sink                             | #438   | [`994b061`](https://github.com/artisam-paiflow/paiflow/commit/994b0615082fb528a87d1c04a8880270d3eaceaa) |
| 2026-09-11 | fix(sandbox): give the swap starter a recipient that can hold USDC                          | #432   | [`b8755ba`](https://github.com/artisam-paiflow/paiflow/commit/b8755ba1bfed49d56feeeba9189885e89004e753) |
| 2026-09-11 | docs(instawards): D1 is live on paiflow.xyz, with the evidence taken there                  | #413   | [`c12adfc`](https://github.com/artisam-paiflow/paiflow/commit/c12adfc6d5d732b4aff982c642eda3a261d9c20a) |
| 2026-09-10 | fix(docs): put SUMMARY.md at the GitBook root so its pages import                           | #431   | [`688b54d`](https://github.com/artisam-paiflow/paiflow/commit/688b54dfe1a622581ebd1065386f91892986bd36) |
| 2026-09-10 | docs(instawards): week-1 interim report as of 10 September                                  | #430   | [`535c855`](https://github.com/artisam-paiflow/paiflow/commit/535c85506f107142a86de78a56f3589a14966f6e) |
| 2026-09-10 | feat(auth): public sandbox session replaces the judge credentials panel                     | #423   | [`728d4c9`](https://github.com/artisam-paiflow/paiflow/commit/728d4c9f0642445b31e6e91e10d8abe6331928db) |
| 2026-09-10 | fix(swap): ingest events on trigger confirm, refuse sub-fee slippage, cover swapper auth    | #422   | [`8b39daa`](https://github.com/artisam-paiflow/paiflow/commit/8b39daad26f55c3fe0c09a9bb7ec4b555891fdda) |
| 2026-09-10 | ci: run the workflow on develop, staging and main only                                      | #421   | [`7782295`](https://github.com/artisam-paiflow/paiflow/commit/77822959be30ec780deec7eec87a1902b6bdd525) |
| 2026-09-09 | fix(scval): serialize the yield constructor with the four args it declares                  | #392   | [`8de1e20`](https://github.com/artisam-paiflow/paiflow/commit/8de1e2038cc9ee0ed2efccc18cea6b504c0f14c4) |
| 2026-09-09 | fix(flows): compile the action the trigger reaches first, not the one drawn first           | #405   | [`55494be`](https://github.com/artisam-paiflow/paiflow/commit/55494bea6fe240d18d9cb0ac6da88a769c1df553) |
| 2026-09-09 | fix(tests): isolate the unit suite from the developer's shell environment                   | #406   | [`8ee010b`](https://github.com/artisam-paiflow/paiflow/commit/8ee010b8c0de1187decf67389db7531e31c1edd7) |
| 2026-09-09 | docs(instawards): D3 "before" evidence from paiflow.xyz, and public commit links            | #411   | [`4302aa6`](https://github.com/artisam-paiflow/paiflow/commit/4302aa66b1eb427db9197f24cf845dd972bcdbfd) |
| 2026-09-09 | test(d1): soroswap check script and the testnet deploy-and-trigger spec                     | #410   | [`c5c50af`](https://github.com/artisam-paiflow/paiflow/commit/c5c50afed0c2976f5a573da7a5d1ae87accf6560) |
| 2026-09-09 | docs(instawards): D1 status and week-1 interim report as of 9 September                     | #409   | [`3da0c2e`](https://github.com/artisam-paiflow/paiflow/commit/3da0c2edb98a750c256f9fb801cf365424a85824) |
| 2026-09-09 | fix(tooling): deploy the factory when the hash is unchanged but none exists                 | #394   | [`861bc5b`](https://github.com/artisam-paiflow/paiflow/commit/861bc5bfdd37afc94e268ef20cdf9a9b43ba5d4a) |
| 2026-09-09 | feat(builder): live Soroswap quote in the swap panel and the deploy review                  | #403   | [`51b3f6f`](https://github.com/artisam-paiflow/paiflow/commit/51b3f6f5fb92e2d3d8fe063fef3987fb1fd07056) |
| 2026-09-09 | feat(builder): show the Swap block, name the router's network, surface its errors           | #402   | [`74a91e6`](https://github.com/artisam-paiflow/paiflow/commit/74a91e61a6f84f1e983d9d84bdbb20541b200540) |
| 2026-09-07 | feat(pipeline): route the swap block through the Soroswap-backed swapper                    | #388   | [`3a76e93`](https://github.com/artisam-paiflow/paiflow/commit/3a76e93695b4b6cd78ab39adf3b0f451ddf8f2a3) |
| 2026-09-07 | feat(swapper): swap through the Soroswap router with a spot-price slippage bound            | #387   | [`3315ea3`](https://github.com/artisam-paiflow/paiflow/commit/3315ea35023471bb75cd281fa9aa488ee9e820d5) |
