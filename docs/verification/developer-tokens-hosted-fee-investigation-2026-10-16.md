# Hosted payment-fee investigation — 2026-10-16

The excessive quote is dominated by renewal of the **shared PAYER WASM code**,
triggered inside the payment invocation. Direct unsigned public-testnet RPC
simulations reproduce it independently of developer-token authentication and the
Paiflow SDK. No diagnostic transaction was signed or submitted, no TTL was
extended, and no fee limit, contract, environment variable or fixture was changed.

## Original observation and limits

The [consolidated hosted report](developer-tokens-hosted-verification-2026-10-16.md) records the
original 08:46:07 UTC A1 `deposit(wallet, 1000000)` preparation: envelope fee
468,961,462 stroops (46.8961462 XLM), including resource fee 468,961,362.
It was never signed or submitted. Its raw RPC simulation/rent breakdown was not
retained; the original exact component split cannot be reconstructed from the
unsigned envelope alone. The fresh simulations below establish the current cause
and reproduce the same scale; they are not historical charged-fee measurements.

## Reproduction and isolation

All calls used `https://soroban-testnet.stellar.org`, normal recording-mode unsigned
`simulateTransaction`, source
`GAPQDCRQ3UXVOSHQI3DJ3XXOCIIHA3IUSYXXH7BQNMWTA2GGH6CU2XFC`,
current account sequence, native amount 1,000,000 stroops and a 180-second timeout.
No hosted prepare endpoint or new API credential was needed. RPC reported protocol
29, RPC 29.0.1 / core 29.0.0. Simulation modifies only its temporary execution
state; simulated contract transfer/pay events do not prove chain payments.

At ledger **5223568**, simultaneous simulations returned:

| Unsigned operation                                     | Minimum resource fee, stroops |        XLM |
| ------------------------------------------------------ | ----------------------------: | ---------: |
| A1 full deposit → Pay                                  |                   469,952,423 | 46.9952423 |
| Extend only existing PAYER code TTL to 500,000 ledgers |                   468,387,383 | 46.8387383 |
| Difference between these separate simulations          |                     1,565,040 |  0.1565040 |

The isolated code operation accounts for approximately **99.67%** of the full
quote. This comparison is not an exact decomposition: operations have different
overheads and refundable fee adjustments. Nevertheless, the code-only operation
has zero instructions, zero disk-read bytes and zero write bytes in its returned
resource declaration, while still reproducing almost the entire fee. It directly
isolates the expensive rent renewal, rather than inferring it from instruction
count or from a low instance TTL.

At **09:03:21 UTC**, all four full-flow simulations used ledger **5223562**:

| Fixture        | Deployment                             | Minimum resource fee, stroops |
| -------------- | -------------------------------------- | ----------------------------: |
| A / selected 1 | `a0f52b95-7caf-4b8d-9ea6-e63b6d1fbc45` |                   469,946,432 |
| A / selected 2 | `dfdc602d-efc3-453c-ad4e-ee9fa7c68851` |                   469,946,432 |
| A / unselected | `83c25bd6-44e4-4af6-bf46-387cb1b42b36` |                   469,946,436 |
| B / foreign    | `d8a0c349-f6b6-49fe-b613-c90f5041c2a8` |                   469,946,432 |

These fresh quotes all exceed 46.99 XLM before adding the 100-stroop inclusion
bid. A1/A2/B used 1,705,891 declared instructions; A-unselected used 1,718,100.
Each simulated execution created two native-token balance entries, even though
their final balances were zero after forwarding. This is another rent cost, but
the shared-code renewal dominates the observed quote.

## Source and on-chain explanation

Both `contracts/triggers/deposit_trigger/src/lib.rs` and
`contracts/actions/payer/src/lib.rs` call
`env.storage().instance().extend_ttl(50_000, 500_000)` during execution.
The SDK method checks and extends **instance and code independently**; a healthy
instance does not prevent a low-TTL shared executable from being renewed.
This was verified in the locally installed exact `soroban-sdk-26.0.1` source
(`storage.rs`, method `Instance::extend_ttl`) and its host call
`extend_current_contract_instance_and_code_ttl`. The
[official SDK documentation](https://docs.rs/soroban-sdk/latest/soroban_sdk/storage/struct.Instance.html#method.extend_ttl)
describes the same independent behavior.

Public `getLedgerEntries` at ledger **5223545** showed:

| Entry                       | Live-until ledger | Remaining ledgers |
| --------------------------- | ----------------: | ----------------: |
| A1 trigger instance         |           5344260 |            120715 |
| A1 PAYER instance           |           5344260 |            120715 |
| Shared DEPOSIT_TRIGGER code |           5601295 |            377750 |
| Shared PAYER code           |           5254427 |         **30882** |

The PAYER code hash is
`b331db1c3e26da4fe8aec7635a567a11fb5e069123c355eaae92d095d5ef457f`.
It falls below the contract's 50,000-ledger threshold, causing extension to
500,000 on every simulation of a first unsubmitted payment. All four fixtures
share this code; deploying another instance does not purchase that renewal.
The fresh instance constructors did not call this payment-time TTL bump, which
explains why deploying the flows succeeded with much lower fees.

The shared code's WASM payload is 17,701 bytes, but this must not be used alone
to estimate rent. Protocol 23 introduced code rent based on its in-memory size;
see [CAP-66](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md).
The diagnostic read also captured the code's cost inputs and current public rent
configuration. At ledger 5223545 the persistent-rent denominator was 1,215,
minimum persistent TTL 120,960, maximum TTL 3,110,400; state-size samples were
approximately 3.583–3.595 GB against a 4 GB target. No exact original rent-rate or
memory-size calculation is asserted from this snapshot.

`lib/stellar/invoke.ts::prepareDepositInvocation` supplies base fee 100,
simulates once, and uses `rpc.assembleTransaction(tx, sim).build()`. It does not
apply an application fee multiplier. The observed envelope fee is resource fee
plus 100 stroops, consistent with that path. This is a maximum authorized fee
quote, not a paid fee: refundable rent/events are reconciled against actual
execution. The [official fee documentation](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering)
explains that distinction. At the initial diagnostic stop no payment had been
submitted, so no actual charged payment fee or refund existed to inspect.

## Initial safe next steps and decisions (before additional authorization)

- Keep payment signing paused under the approved 1 XLM ceiling. Nonfinancial
  authorization, discovery, revocation and management tests can continue.
- Treat shared-code rent policy/maintenance as the engineering issue. Review
  separate instance/code renewal and bounded renewal APIs against retention and
  retirement requirements, then test fee limits at TTL boundaries. Changes to
  deployed contracts require the normal build/review/upload/configuration process;
  this investigation does not authorize or implement them.
- The existing TTL-maintenance worker uses the same 50,000/500,000 policy and
  explicit fee budgets. Invoking it merely to make the next customer payment
  cheaper would transfer the expense to the relayer; it is not a free fix and was
  not attempted. Any intentional operator-funded shared-code rent purchase needs
  a separately reviewed budget and explicit authorization.
- Do not reduce declared fees below simulation requirements or reinterpret the
  ceiling as an actual-charge allowance. Do not reuse the previous unrelated
  75 XLM testing exception. No next payment is authorized by these diagnostics.
- Re-simulation is necessary immediately before any later approved signing:
  network rent rates, ledger age and external shared-code renewal can change
  quotes. At this initial stop, an invocation renewing shared code had not happened
  or been relied upon; the authorized continuation below later confirmed it.

Local raw public-RPC evidence is retained in `/tmp/fee-investigate-*.json`,
`/tmp/fee-isolate-code.json` and `/tmp/fee-isolate-pair.json`; helper scripts contain
only public addresses and unsigned simulation logic. No credentials, wallet
profile, signed envelope or seed phrase is included in this report.

## Authorized payment continuation and independent chain proof

The user subsequently authorized analogous shared-template TTL-renewal
transactions in the testing environment despite the original 1 XLM ceiling.
That authorization superseded the initial payment pause for this known cause;
it did not change runtime fee guards, authorize staging changes or cause a
separate maintenance/prepayment transaction. The wallet agent performed normal
Freighter payment approval and submission; this investigator remained read-only.

Fresh preflight at **09:22:00.792 UTC**, ledger **5223786**, reproduced full A1
resource fee 470,755,156 versus isolated PAYER-code renewal 469,188,185 stroops
at the same ledger. PAYER code had 30,641 ledgers remaining. The fresh hosted
payment preparation subsequently declared 470,776,248 stroops total.

Independent `getTransaction` at **09:25:23.428 UTC** confirmed payment
`f77ab49e11ec50aa73898b2bbd3fac5c180934c7c8172242738493b577ff10c5`
**SUCCESS**, ledger **5223825**. Its protocol-29 transaction metadata reconciled:

| Fee component                                 |         Stroops |            XLM |
| --------------------------------------------- | --------------: | -------------: |
| Declared envelope ceiling / initial fee debit |     470,776,248 |     47.0776248 |
| Refunded after execution                      |      61,223,426 |      6.1223426 |
| **Net charged (`result.feeCharged`)**         | **409,552,822** | **40.9552822** |
| Rent component (`rentFeeCharged`)             |     409,542,270 |     40.9542270 |

The before/after native fee events independently satisfy initial debit minus
refund equals `result.feeCharged`; the refund is not subtracted twice. The
[official metadata schema](https://github.com/stellar/stellar-xdr/blob/main/Stellar-ledger.x)
defines transaction-stage fee events and the separate rent field. This actual
payment paid substantial rent; the earlier 46.8961462 XLM original preparation
remains unsubmitted and must not be described as the payment's actual fee.

The confirmed operation events show exactly 1,000,000 native stroops at every
step: controlled wallet → A1 trigger → A1 PAYER → controlled wallet. The trigger
emitted `deposit(wallet,1000000)` and PAYER emitted `pay(wallet)` with native asset
and amount 1,000,000. Source and recipient are the same wallet, so these events
establish the round-trip payment; they do not imply a net wallet gain of 0.1 XLM.

Post-payment `getLedgerEntries` at ledger **5223828** showed shared PAYER code
live-until **5723825**, exactly payment ledger **5223825 + 500000**, versus
**5254427** before. Its remaining TTL was 499,997. This directly confirms the
renewal predicted by the read-only isolation.

Fresh unsigned simulations after confirmation showed the expected drop:

| Fixture                    |  Ledger | Resource fee, stroops | Resource fee, XLM |
| -------------------------- | ------: | --------------------: | ----------------: |
| A1 repeat                  | 5223828 |                15,589 |         0.0015589 |
| A2 first payment           | 5223828 |             1,573,547 |         0.1573547 |
| A unselected first payment | 5223829 |             1,573,550 |         0.1573550 |
| B foreign first payment    | 5223829 |             1,573,547 |         0.1573547 |

A2 and the other fresh instances still create their two native-token balance
entries; A1 repeat creates none. These are simulation estimates before the
100-stroop inclusion bid, not additional submitted payments at that observation.

The wallet agent then submitted the independently prepared A2 payment
`036640f07fbfee7f809c1bfe81722f3c5fcbdcc1d86f84e50b8d9518f2a10496`.
Independent RPC at **09:27:11.495 UTC** confirmed **SUCCESS**, ledger **5223844**:

| A2 fee component                      |       Stroops |           XLM |
| ------------------------------------- | ------------: | ------------: |
| Declared / initial debit              |     1,573,647 |     0.1573647 |
| Refund                                |       208,338 |     0.0208338 |
| **Net charged (`result.feeCharged`)** | **1,365,309** | **0.1365309** |
| Rent component                        |     1,354,757 |     0.1354757 |

The fee events reconcile exactly. Independent confirmed metadata again contains
native 1,000,000-stroop transfers wallet → A2 trigger → A2 PAYER → same wallet,
plus the exact deposit and pay events. Thus the cheaper subsequent quote was
validated by a real successful payment, not only another simulation.
No source transaction was started by this investigator. Wallet execution,
replacement credential recovery and replay checks are in the
[consolidated hosted report](developer-tokens-hosted-verification-2026-10-16.md); the statements here are limited to independent public chain evidence.

Sanitized public evidence snapshots, mode 0600, are retained locally as
`/tmp/fee-authorized-preflight-pair.json`,
`/tmp/fee-authorized-preflight-ledger.json`,
`/tmp/fee-authorized-postpayment-ledger.json`,
`/tmp/fee-authorized-postpayment-comparison.json` and
`/tmp/fee-chain-<payment-hash>.json` for both payment hashes above.
