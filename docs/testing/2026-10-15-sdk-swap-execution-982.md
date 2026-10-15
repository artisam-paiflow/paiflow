# Packed SDK Swap execution, 2026-10-15

This closes the isolated real Swap execution gap tracked by
[#982](https://github.com/webnxt-2030/pinkraft/issues/982). The earlier
[verification checkpoint](2026-10-14-sdk-live-verification.md) correctly recorded
an unsigned fee refusal. After reviewing a fresh estimate, the user separately
authorized one testnet attempt with a **75 XLM total declared transaction fee
ceiling**, keeping the payment input at **0.1 XLM**. This ceiling admitted the
server's simulated fee; it did not replace that fee with 75 XLM. The one-attempt
exception is consumed and does not authorize future 75 XLM fees.

## Environment and artifact

- App: `https://pinkraft.xyz`, testing, hosted commit
  `679828519d5f74bb282511039fd6ce26dc33cfc4`; health version `6798285`.
- Normal testing deployment: `245ad07a-8f59-49d6-8d12-bba1ddbb1246`, `SUCCESS`.
  [Exact-head Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38675573507)
  passed before this rehearsal.
- Existing isolated deployment: `a8f9b6ea-9bbf-4674-8616-34902c7aaa5f`.
- Wallet and fixed payout recipient:
  `GATA3FUI5NPFDGWHC42LTPKC4P3YIAKLOJKIPCWOP5XJMTFSVYFB6MGS`.
- Network: testnet; canonical prepared/signing passphrase
  `Test SDF Network ; September 2015`.
- Unpublished packed `@paiflow/sdk@0.1.0`, unchanged integrity:
  `sha512-uotbrEnW53PRqaTzhIVPpSEc3mySpOsv1P7h8613Z3BZc2/TQvARDX90gvX9pbqU59JTL0lYaq6htoHGi7vSow==`.
- Existing authorized Circle USDC trustline: issuer
  `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
  limit `1.0000000`, initial balance zero. No new trustline or deployment was
  needed for this attempt.

The verified pipeline was native Deposit Trigger → Swapper → USDC Pay, with
full payout to the controlled wallet. Its live WASM hashes matched the current
workspace artifacts: Deposit Trigger `472061679c6b6fc313f70107c09ed7ca3d21ccd0aef15b082c2533632ee75602`,
Swapper `b26ca591192cf9c092447585f487a2b754e6285dfde7804df144f8116196fe46`,
and Payer `b331db1c3e26da4fe8aec7635a567a11fb5e069123c355eaae92d095d5ef457f`.
Readiness also checked the configured native/USDC assets, router, factory, pair,
controlled recipient, 100 bps slippage and 300-second contract deadline window.

## One submission and independent finality

The packed SDK prepared `deposit(wallet, 1000000)`. Its unsigned response was
saved privately before fee/body validation. Normal Freighter consent signed that
original body; the source wallet, exact operation/arguments, canonical network,
finite transaction time bounds and unsigned/signed body hash were checked before
one SDK `execute.submit(wait=true)` call. An exclusive durable marker preceded
the submission. No private key was accessed or exported.

- Original transaction:
  `f2794ab18a0b353e9f4aadc0026cc586de2da84c1956cb3dbba787d14b30a6c0`.
- SDK submission, deployment-bound SDK receipt and independent testnet RPC:
  `SUCCESS`, ledger **5202637**, ledger time `2026-10-15T03:59:32Z`.
- Native token transfer from the controlled wallet to the trigger:
  **1000000 stroops (0.1 XLM)**.
- Same-hash Swapper event: native input **1000000**, USDC output **106193**.
- Same-hash USDC transfer from the pipeline Payer to the controlled wallet:
  **106193 stroops (0.0106193 USDC)**.
- Direct USDC wallet balance: **0 → 106193**, matching the complete output.
- Direct native and USDC balances on all three pipeline contracts: **six zero
  balances**, independently observed after finality at ledger **5202648**.
- Indexed SDK events corroborated the native `RECEIVE`, Swapper input/output and
  USDC `pay` recipient/payment under the original hash.

The fresh quote minimum was **105447 USDC stroops**; actual output **106193**
exceeded it. Separately, successful execution under the verified current Swapper
WASM enforces its execution-time reserve/slippage minimum. A pre-submission quote
is an estimate and is not a guarantee of an external market price.

After RPC success, the private verification harness initially asserted because
Stellar SDK 16 returns each RPC event's contract ID as a `Contract` object, while
the harness compared it directly with an address string. A narrowly reviewed
adapter normalized the contract ID and rejected malformed identities. The
original hash was then verified using read-only receipt/event/balance calls.
**No replacement SDK preparation, signing or resubmission was used to resolve that assertion.**
The earlier unsigned fee refusal and its separate markers were retained.

## Fees and cleanup

| Quantity                                       |   Stroops | Testnet XLM |
| ---------------------------------------------- | --------: | ----------: |
| User-approved maximum total declared fee       | 750000000 |          75 |
| Actual prepared/declared fee                   | 593617843 |  59.3617843 |
| Actual net fee charged, RPC transaction result | 516198331 |  51.6198331 |
| Fee refund corroborated by native fee event    |  77419512 |   7.7419512 |

The 0.1 XLM payment input is separate from these fees. Transaction metadata
reported **516169576 stroops (51.6169576 XLM) of rent**, included in the net fee
rather than added to it. The remaining net fee was **28755 stroops (0.0028755 XLM)**.
No TTL prepayment, restoration, contract-policy change, manual fee inflation or
automatic retry was used.

The Swapper code TTL's live-until ledger moved from **5246227** (read at ledger 5202541) to **5702637** (read at ledger 5202674), an extension of **456410 ledgers**.
The contract's `instance().extend_ttl(50000, 500000)` extends instance and code
independently; the code had crossed the 50,000-ledger threshold. This dated
before/after observation found this was the only TTL increase among 12 inspected
code/instance entries. It concerns shared code and does not prove exclusive
causality or assign all rent to a single key.

Exactly one subsequent **unsigned** simulation at ledger **5202674** estimated
**33618 stroops (0.0033618 XLM)** total fee, including **33518 stroops (0.0033518 XLM)** of resource fee,
with no restoration required. It was not signed or submitted. This comparison
supports a front-loaded rent explanation for this observation; it is neither a
second execution nor a guarantee of future fees.

After verification, the newly minted deployment-scoped testing API token was
revoked through the supported owner route. Cleanup reconfirmed zero pipeline
balances. The existing USDC trustline remains open with **0.0106193 USDC**, owned
by the controlled wallet; its **1 USDC** limit remains unchanged. Credentials,
signed envelopes, opaque preparations and private journals remain restricted and
git-ignored. No staging/mainnet changes, SDK/backend/contract source changes,
package release or publication occurred.

This is one completed isolated testnet Swap, with unusually high observed fees.
It does not establish cheap execution, a second successful Swap, arbitrary
routes/assets, production readiness, or resolution of the separate demo and
unattended-scheduler limitations.
