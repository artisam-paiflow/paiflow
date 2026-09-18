# D2 evidence pack

Everything here comes from [paiflow.xyz](https://paiflow.xyz), the public app on Stellar testnet.
Nothing from a development environment counts ([counting rules](../../metrics.md)). Every API token
is redacted; the full `pfk_…` value never appears in a file or a capture.

| File                                                                               | What it is                                                                                                                 | Status                     |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `api-access-panel.png`                                                             | The API access panel on the evidence deployment, token redacted. The committed file is a local capture until replaced      | TODO(#471)                 |
| `01-curl-transcript.md`                                                            | The guide's sequence from a clean shell: curl prepare → `stellar tx sign` → curl submit → curl events                      | Events step pending (#483) |
| `02-prepare-response.json`                                                         | The prepare response: the unsigned envelope (the sample XDR payload SOW §5.1 Week 4 asks for)                              | Present                    |
| `03-submit-response.json`                                                          | The submit response: `SUCCESS` and the swap tx hash                                                                        | Present                    |
| `04-getTransaction.json`                                                           | Raw RPC `getTransaction` for the swap, the durable copy if testnet resets                                                  | Present                    |
| `05-events-response.json`                                                          | The events response with the `swap` event and `nextCursor`                                                                 | TODO(#471)                 |
| `06-audit-rows.json`                                                               | `API_EXECUTE_PREPARED` / `API_EXECUTE_SUBMITTED` / `API_EXECUTE_CONFIRMED` for the run, from the admin audit log, redacted | Present                    |
| `07-stellar-expert-swap.png`                                                       | stellar.expert showing the `swap_exact_tokens_for_tokens` sub-invocation on the Soroswap router                            | TODO(#471)                 |
| `08-openapi.json`                                                                  | `https://paiflow.xyz/api/v1/openapi.json` as served                                                                        | Present                    |
| `09-postman-run.png`                                                               | The Postman collection run against paiflow.xyz                                                                             | TODO(#471)                 |
| `10-e2e-api-run.json`, `10-e2e-api-run.getTransaction.json`, `10-e2e-openapi.json` | Written by `tests/e2e/d2-api-testnet.spec.ts`: the same sequence, repeatable                                               | Optional                   |
