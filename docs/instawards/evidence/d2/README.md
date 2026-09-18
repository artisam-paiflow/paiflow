# D2 evidence pack

Everything here comes from [paiflow.xyz](https://paiflow.xyz), the public app on Stellar testnet.
Nothing from a development environment counts ([counting rules](../../metrics.md)). Every API token
is redacted; the full `pfk_…` value never appears in a file or a capture.

The run these files record: **18 September 2026, 02:31:52–02:32:17 UTC**, deployment
`ad0843d9-f6de-422f-b216-717caa92aa8a`, 10 XLM → 1.0584167 USDC through the Soroswap router,
transaction [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7).

| File                                                                               | What it is                                                                                                                 | Status   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| `api-access-panel.png`                                                             | The API access panel on the evidence deployment, showing the minted token by its prefix only                               | Present  |
| `01-curl-transcript.md`                                                            | The guide's sequence from a clean shell: curl prepare → `stellar tx sign` → curl submit → curl events                      | Present  |
| `02-prepare-response.json`                                                         | The prepare response: the unsigned envelope (the sample XDR payload SOW §5.1 Week 4 asks for)                              | Present  |
| `03-submit-response.json`                                                          | The submit response: `SUCCESS` and the swap tx hash                                                                        | Present  |
| `04-getTransaction.json`                                                           | Raw RPC `getTransaction` for the swap, the durable copy if testnet resets                                                  | Present  |
| `05-events-response.json`                                                          | The events endpoint: the run's three events by transaction hash, then the feed paged forward with the opaque cursor        | Present  |
| `06-audit-rows.json`                                                               | `API_EXECUTE_PREPARED` / `API_EXECUTE_SUBMITTED` / `API_EXECUTE_CONFIRMED` for the run, from the admin audit log, redacted | Present  |
| `07-stellar-expert-swap.png`                                                       | stellar.expert's invocation tree for the swap: `deposit` → `execute_step` → `swap_exact_tokens_for_tokens` on the router   | Present  |
| `08-openapi.json`                                                                  | `https://paiflow.xyz/api/v1/openapi.json` as served                                                                        | Present  |
| `09-postman-run.png`                                                               | The Postman collection run against paiflow.xyz: Submit execute at `200 OK`, its test passing, the swap's hash in the body  | Present  |
| `10-e2e-api-run.json`, `10-e2e-api-run.getTransaction.json`, `10-e2e-openapi.json` | Written by `tests/e2e/d2-api-testnet.spec.ts`: the same sequence, repeatable                                               | Optional |

The explorer capture is worth reading in full. It shows the router call as
`swap_exact_tokens_for_tokens(100000000, 10509881, […], …) → [100000000, 10584167]`: the second
argument is `amount_out_min`, derived from the flow's slippage setting, and the actual output beat
it. Its `Valid before 2026-09-18 02:34:52` is the same expiry the prepare response carries, which
ties the explorer's record to the committed one.

`08-openapi.json` is a copy of the committed [`docs/api/openapi.json`](../../../api/openapi.json),
which the drift test holds to the handlers. It was byte-identical to the live endpoint on
18 September and is refreshed whenever the committed copy changes, so the live endpoint serves the
same bytes once the change is promoted.

## The Postman run produced its own swap

The collection was imported and run against paiflow.xyz on 18 September. It is not only importable:
driving it end to end — prepare, sign locally, submit, list events — landed a second swap on
testnet, [`27f68188…`](https://stellar.expert/explorer/testnet/tx/27f681889bfebdab92a4d9e6d70770ea5df72bd597c627bc5c0014d0d86bfbfb), ledger 4736183, 1 XLM → 0.1055731 USDC, with the
`SoroswapRouter` `swap` event in the transaction. So the collection is evidenced by a transaction
rather than only by a screenshot; [`09-postman-run.png`](09-postman-run.png) shows the run that
produced it. The capture is cropped to the Postman panes, dropping the window title bar, the
editor's assistant panel and the desktop taskbar; nothing in the request or response is altered.

## The 15 September run

An earlier swap, [`5b1e738f…`](https://stellar.expert/explorer/testnet/tx/5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be),
was executed through the same API on 15 September and is recorded in the
[evidence index](../README.md#transactions). Its deployment, token and event rows lived in the
database the public app used until 16 September, kept as an archive the app no longer writes to, so
it could not supply the events response, and this pack documents the 18 September run instead.
