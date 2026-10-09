# Subscription state getter — isolated TESTNET comparison (#799)

Verified 2026-10-03 against public Stellar TESTNET, protocol 29. Public addresses, hashes,
ledger numbers, per-call timings, state observations, and independently re-queried results are in
[`evidence/799-testnet.json`](evidence/799-testnet.json). It contains no keys or signed XDR.

## Artifacts and ABI

| Artifact                                                    | Stored version | Release WASM SHA-256                                               |
| ----------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| Base `origin/hackathon` (`553b0180`), standard Subscription | 5              | `1d9d2f5f4ae558b48c3701f1dc4c332b5fe318104c993dd6a400597b49d07221` |
| #799 standard Subscription                                  | 6              | `7f1a95be6bc08ccf147b098c2b110ae73ea9b89f9d97efa755e3a250e1103e88` |

Both were built with the checked-in Cargo lockfile and workspace release profile. Extracted
compiled interfaces differ only by `state()` and `SubscriptionState`. Instance executable hashes
and stored versions were independently read back after the rehearsal. Dev artifacts are unchanged.

The product invariant is SPEC.md §3.1: “A period elapses **and** the subscriber has authorized an
allowance.” The snapshot is advisory; on-chain charge checks and fresh token allowance remain
authoritative. See [contract documentation §4.1.4](soroban-smart-contracts.md#414-combined-subscription-preflight-799).

## Actual scheduler charges

Disposable funded platform-relayer and subscriber accounts deployed v5 and v6 directly through
the constructor with native XLM, a 200-stroop period amount, a 3,600-second interval, an end time
one day ahead, and empty downstream targets. Each subscriber approved 2,000 stroops. The v6
fixture also exercised relayer rotation before restoring the configured platform relayer.

The rehearsal invoked the actual subscription cron Route Handler with the actual production
readers, `withRelayerChannel` fallback lock, fresh source loading, charge construction/signing
simulations, submission, and finality polling. Channels were disabled. Database deployment
selection and updates were test stubs containing only the fixture rows; Redis was absent. This
checks scheduler and chain execution, not production DB persistence, Redis leasing, funded
channel execution, factory graph compilation, browser/wallet consent, or USER relayer endpoints.

| Successful due-contract path       |           Preflight RPC requests | Full Route Handler wall time | Final ledger |
| ---------------------------------- | -------------------------------: | ---------------------------: | -----------: |
| v5 legacy fallback, cache disabled | 16 (2 probe + 14 existing reads) |                    11,571 ms |    5,002,802 |
| v6 combined state, cache disabled  |                                4 |                     7,242 ms |    5,002,804 |

Both charges finalized `SUCCESS`. Subscriber token balance fell by exactly 200 stroops per
fixture; the platform relayer paid fees. `next_charge_at` advanced by exactly 3,600 seconds, and
fresh post-charge schedule reads drove catch-up termination and the update stub. All six v6
state fields matched their individual getters after charge. The legacy missing-export diagnostic
selected the intended fallback on a real RPC response.

These are one-shot observations, including different inclusion/finality waits. They are not a
universal latency, transaction-fee, or throughput comparison.

## Read-only request and timing comparison

After the charges, three alternating samples per version replayed the uncached preflight read
sequence, without submitting further transactions. The schedule was now in the future; this
replay deliberately read all six fields and allowance to compare the due-preflight read cost.
Legacy cancellation/schedule reads ran in parallel, then four configuration reads in parallel,
then allowance. Combined state and allowance ran sequentially. Each account lookup corresponded
to one RPC account-ledger request, and each getter/allowance read to one simulation.

| Read sequence                                              | Requests per sample | Wall-time samples (ms)    | Median (ms) |
| ---------------------------------------------------------- | ------------------: | ------------------------- | ----------: |
| Original v5 getters + fresh allowance, no capability probe |                  14 | 2,617.1; 2,765.6; 2,252.3 |     2,617.1 |
| v6 state + fresh allowance                                 |                   4 | 1,534.7; 1,331.1; 1,228.2 |     1,331.1 |

The public evidence separately records per-RPC durations. Summing overlapping RPC durations is
not wall time. Small public-RPC samples depend on geography, load, and connection state; the
reliable result is the request reduction. Read-only contract simulations submit no transaction
([Stellar simulateTransaction reference](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction)).

Instrumented local tests separately verify warm legacy immutable caches (8 original requests,
10 with the initial capability probe), early exits (2 new versus 4 original), failed preflight,
Dev's original 14-request uncached path, and fresh mutable and post-charge reads. A failed
capability probe is remembered only inside one run; old instances are probed again next run.

## Cancellation limit and failed attempts

Getter equivalence passed initially, after a failed cancellation with full rollback, after
relayer rotation, and after the actual successful charge. The live cancellation attempts failed
authorization on the nested token `approve` call. The unchanged contract derives that call's
expiration argument from execution ledger + 1, and the simulation-recorded authorization may not have matched at inclusion. A ledger-dependent
authorization mismatch is a likely cause, but the precise root cause was not isolated. A bounded alternate zero-allowance authorization tree also failed in the
second harness attempt. Neither change was made to application or contract cancellation code.

Successful live cancellation/resubscription is therefore **not claimed**. Rust tests verify
getter equivalence through successful cancellation/resubscription and allowance revocation,
charge failure rollback, both charge entry points, relayer rotation, no getter auth/events/TTL
changes, and integer boundaries. Native mocked authorization does not prove real-wallet
cancellation interoperability. Resolving that broader path remains separate work.

The independent re-query covers all 26 rehearsal transactions across setup attempts and actual
scheduler submissions: 23 `SUCCESS`, three cancellation `FAILED`. Failed attempts are included
explicitly; only the final fixture pair is used for measured scheduler/read comparisons.

## Validation and release boundary

Local validation passed: 2,895 Node tests; 206 Rust workspace tests with one intentionally ignored
existing profiling test; 61 focused Node tests; typecheck; lint; production build; formatting;
deny-warning Clippy; and dependency audit with the repository's existing exceptions. The
requested reviewer independently passed 57 focused Node tests and 13 Subscription Rust tests
and reported no actionable source findings. Remote CI results belong to the PR's final head.

This rehearsal uploaded WASM and deployed only disposable TESTNET fixtures. Shared template
configuration/databases, production, existing flows, and cron flags were unchanged. The
temporary network harness is excluded from normal unit tests. Shared template activation and
existing-instance redeployment require separately authorized release work under contract docs
§4.3. Source changes do not upgrade existing immutable instances.
