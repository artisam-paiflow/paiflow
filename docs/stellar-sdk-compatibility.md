# Stellar SDK ledger compatibility — #792

Verified on 2026-10-03 against public TESTNET. Implementation branch:
`fix/792-sdk-ledger-decoding`, based on `hackathon` at `a4df4515`.

## Root cause and reproduction

The app used `@stellar/stellar-sdk` **15.1.0**, which depends on
`@stellar/stellar-base` **15.0.0** and `@stellar/js-xdr` **4.0.0**. That base
package's generated XDR schema recognizes only Soroban credential values 0
(source account) and 1 (address). CAP-71 added values 2 (address V2) and 3
(address with delegates). Updating the XDR runtime alone would not update
the generated Stellar schema.

The public RPC reported protocol **29**, RPC version
`29.0.0-b2b701685c79aee17fe4eb22dbd08a5dfd11594d`, and captive core
`stellar-core 29.0.0 (4eb83337380a29ad0907f4e32196ce97b8dc7649)`.

Both SDK readers decode ledger metadata before returning their scalar fields:

- `getLatestLedger()` decodes `headerXdr` and `metadataXdr`. Replaying the
  public metadata of ledger **4995191** through its latest-ledger parser
  reproduces `XDR Read Error: unknown SorobanCredentialsType member for value 3`.
- A live `getLedgers({ startLedger: 4995191, pagination: { limit: 1 } })`
  reproduces the same error in SDK 15.1.0.
- A bounded batch covering **4995187–4995386** contained **21** metadata
  decoding failures in SDK 15.1.0: 16 for value 3 and 5 for value 2. SDK
  **16.3.1** decoded all 200 metadata values, including those 21 failures.
- The latest-ledger replay and live historical-ledger call both succeed with
  SDK 16.3.1. Several current latest-ledger reads also succeeded with SDK 15;
  failure depends on ledger contents. This sample does not measure production
  failure frequency.

No captured metadata, signatures, or encoded transaction envelopes are saved
in this report. Regression fixtures generate synthetic, unsigned ledger
metadata containing credential value 3.

## Selected fix

Update the existing SDK dependency to **`^16.3.1`**, with 16.3.1 in the lockfile.
Its bundled generated schema includes CAP-71 credentials, and it continues
to use `@stellar/js-xdr` **4.0.0**. The supported v16 line avoids the broader
XDR API migration in v17. Node 22 already meets its runtime requirement.
This verifies the observed credential incompatibility on protocol 29; it is
not a claim of complete support for every protocol-29 feature.

Necessary type compatibility adjustments preserve the encoded behavior:
boolean ScVals use `xdr.ScVal.scvBool`, credit assets must have an issuer, and
a Horizon test mock explicitly supplies only the transaction-source interface.
The real-client timeout regression verifies that the SDK's HTTP client still
aborts stalled requests.

The shared subscription/payroll approval helper keeps the existing allowance
delta (**3,110,400 minus a 10-ledger buffer**), user source, unsigned envelope,
180-second timeout, and simulation. Invalid sequence values or an expiration
that would exceed u32 are refused before simulation.

Payouts retain protection on transport/decoding errors, invalid transaction
statuses, invalid sequences, missing/mismatched ledger rows, and malformed
close times. A close time must be a decimal string within u64. A transaction
is finished only after confirmed `SUCCESS`/`FAILED`, or when a valid closed
ledger's time is **strictly greater** than the envelope's `maxTime`.
Wall-clock time does not establish expiry.

Network configuration remains governed by [CLAUDE.md §7.5](../CLAUDE.md#75-networks).
There is no new raw RPC transport, dependency override, audit exception,
database migration, or contract change.

## Validation and remaining rehearsal

Automated regressions cover both real SDK parsers, simulated unsigned approval
construction with exact stroops, expiration bounds, malformed fields, failed
simulation, unavailable RPC, and payout finality/expiry error handling.

Local checks passed: **2,821 tests in 192 Node/DOM test files**, typecheck,
format/diff checks, dependency audit with only the existing accepted
exceptions, and Rust formatting, Clippy, and **176** workspace tests. Migrations
and seed ran only against a disposable local test database.

The requested independent subagent review found no actionable introduced
defects. It independently passed typecheck, diff checks, ledger/payout
regressions, the real HTTP timeout test, and relayer-channel signing, signer,
Dev mutation, and trustline suites. This was a code review, not a formal audit.

The local production build **passed on retry** in approximately 65 seconds,
including compilation, type checking, page generation, and build tracing.
It used a disposable seeded database, production mode, and these build-process
settings, without changing application code or `next.config.ts`:

```bash
NODE_OPTIONS=--max-old-space-size=1536 RAYON_NUM_THREADS=2 pnpm build
```

Three earlier Webpack workers exited with `SIGKILL` (default heap, 2,048 MiB,
and 1,024 MiB). The session's cgroup subsequently reported **three OOM kills**,
consistent with memory pressure causing those failures. The successful retry
peaked at about **4.8 GiB of aggregate process RSS**; its OOM kill counter
remained unchanged. This establishes a local build pass with bounded native
thread count and Node heap, not a remote CI or deployment result. Remote CI
results must be checked on the PR. Existing Auth.js/Jose Edge-runtime and ESLint plugin
warnings remain non-fatal.

A read-only TESTNET run exercised the actual application helpers:

- `prepareTokenApproveInvocation()` simulated a native-token approval from
  public test account `GAENGOXYLZTF5JGJU6LYNM3VNVZ7C5YOHVHH4SVITDMPNLHGWJYXKEUJ`
  to the existing isolated standard subscription
  `CCYB4MVZYLUDTTCKKBTJZ3BAKXG4MLI76DYKFNFWWPJVCAYJS7LHYIUQ`.
  It returned zero envelope signatures, expiration **8107012**, and fee
  **2193951** stroops. No transaction was signed or submitted.
- `payoutTransactionFinished()` accepted existing public confirmed-success
  hash `07fdafc9c183f1d41303ba90a7f66b57aa9cb72c42f734ac5575ca133a854b7e`
  and confirmed-failure hash
  `01fc0f37ccf7579a88af893dbe3229160bea4e2b3212d0b5bbe7c545e7404a08`.
  For a nonexistent hash, it returned true for a past ledger-time bound and
  false for a future bound.

The isolated app environment and user wallet rehearsal remain outstanding:
ordinary and Dev subscription approval, configured-relayer scheduled payout,
and payout preparation/submission/retry through the app. Track these with
[#790](https://github.com/webnxt-2030/pinkraft/issues/790) and the readiness gate
in [#729](https://github.com/webnxt-2030/pinkraft/issues/729); automated reads and
unsigned simulation do not complete those gates. Template activation,
deployment, and existing-flow migration require their separate release work.

Wallets Kit 1.9.5 still pulls in its own deprecated stellar-base peer and has
existing peer-version warnings, including the Trezor adapter. Application
wallet boundaries pass addresses and XDR strings rather than SDK objects.
The automated checks do not establish real hardware/browser wallet compatibility.

## Upstream references

- [SDK v16.0.0 release: CAP-71 and bundled base](https://github.com/stellar/js-stellar-sdk/releases/tag/v16.0.0)
- [SDK v16.3.1 release](https://github.com/stellar/js-stellar-sdk/releases/tag/v16.3.1)
- [SDK release support policy](https://github.com/stellar/js-stellar-sdk/blob/main/RELEASE_POLICY.md)
- [getLatestLedger response](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLatestLedger)
- [getLedgers response](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgers)
