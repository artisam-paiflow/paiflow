# Full changelog

Every change merged during the Instawards sprint, newest week first. Each week's table is also
reproduced in that week's report. Commit links open on the public repository.

Generated with `pnpm instawards:changelog` — see [week 1](week-1.md) for the exact invocation.

## Week 1 — 7–13 September 2026

D1: the swapper executes a real swap through the Soroswap testnet router. Reported in full in
[week 1](week-1.md).

| Date       | Change                                                                                      | Issues | Commit                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
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

_Four dependency-maintenance merges of 12 September (#444, #445, #457, #458) carry no deliverable
change and publish to the mirror with this report; their commit links appear in the week-2 table._
