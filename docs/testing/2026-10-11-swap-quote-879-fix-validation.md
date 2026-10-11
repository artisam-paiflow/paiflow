# Swap quote issue #879 — fix validation

Issue: [#879](https://github.com/webnxt-2030/pinkraft/issues/879). Implementation follows the [investigation](https://github.com/webnxt-2030/pinkraft/issues/879#issuecomment-6106122931). The initiating cause of the original staging failures remains unconfirmed.

## Behavior

- Read-only contract simulation now loads the source through `getLedgerEntries`, avoiding Stellar SDK 16.3.1's lossy `getAccount` error handling. A successful empty account response retains `INSUFFICIENT_FUNDS`/402. A rejected request or malformed account response produces `UPSTREAM_RPC`/502.
- Rejected `simulateTransaction` requests produce structured `UPSTREAM_RPC`/502. Returned contract failures retain `SimulationError` and their Soroban diagnostics.
- Factory `get_pair` becomes the missing-pool `VALIDATION`/422 message only when the top-level failure is contract error 205 and the innermost diagnostic error frame identifies that factory and code. Transport failures, unrelated contract failures, unattributed errors, contradictory diagnostics, and another contract's propagated 205 are preserved.
- The configured relayer source and real ledger sequence remain unchanged, including the payer recipient getters. There is no synthetic simulation account, account funding, provider change, signing, or submission in the quote path. Source account lookup still occurs for each getter.

## Local validation

`pnpm test tests/unit/stellar/contract-read.test.ts tests/unit/stellar/soroswap.test.ts tests/unit/soroswap/quote.test.ts tests/unit/api/soroswap-quote.test.ts tests/unit/stellar/soroban-errors.test.ts tests/unit/stellar/pipeline-error-hint.test.ts`

**6 files, 77 tests passed.** Coverage includes absent accounts versus rejected ledger reads, lossy SDK-style error messages, malformed account entries, rejected simulations versus contract failures, strict missing-pair attribution, the existing payer getters, and a full quote retry after a transient factory RPC failure. The retry exercises all five quote getter functions through real SDK transaction construction and ScVal decoding, preserves the expected quote, and asserts no transaction signatures or submissions.

`pnpm typecheck`: **passed**.

`pnpm build`: **passed** (parent validation, including production compilation and type checking).

## Operator telemetry

`contract read RPC failed` records contain `operation`, `functionName`, `elapsedMs`, an allowlisted `category`, `code: UPSTREAM_RPC`, and an internal `requestId` generated once per quote. Categories include `network`, `timeout`, `aborted`, `http`, `json_rpc`, `unknown`, and `invalid_response`. `contract read source account absent` records include `category: account_absent` and the same timing/context fields.

No arbitrary upstream error text, provider URL, headers, source account address, or request body is included in these records. The quote ID is internal and is not a client request ID or a response header; correlate bounded browser requests with server timestamps and these records. RPC failure logs preserve their category even when the SDK throws an opaque message, in which case the category may remain `unknown`. Returned contract diagnostics retain the application's existing public-chain diagnostic detail behavior.

## Live acceptance still pending

These are local regression results. No post-fix staging build or real swap has been exercised, and no app or contract deployment was performed. Earlier successful staging quotes are pre-fix investigation evidence. Keep #879 open until the promoted build is live, bounded timestamped staging quotes are correlated with sanitized telemetry, and the existing real swap path is verified.
