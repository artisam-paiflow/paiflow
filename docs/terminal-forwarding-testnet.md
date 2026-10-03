# Terminal Pay/Split v4 testnet verification (#797)

Verified on **2026-10-03**, public Stellar testnet, protocol 29, using source commit
`1fa6be742278c4b5d4143f0212b3441f709e51ea` and baseline `4bcdc958` (v3).
The [public evidence](evidence/797-testnet.json) records transaction hashes, ledgers, balance
assertions, RPC simulations, factory results, and the application snapshot. No signed envelopes
or wallet secrets are included.

The rehearsal uploaded release WASM and used a newly deployed, isolated factory:
`CB4LFLKC725O42DJYOXPJCBOG264HU3CAHCIYNU7KAYSJIPCTWCFR5AB`.
An isolated copy of the application used a disposable local Postgres database. Shared runtime
configuration, shared databases, and existing deployments were unchanged.

## Real trigger chains, retained funds, and rollback

Each row below passed through both **Receive (`deposit`)** and **Webhook (`execute`)** contracts,
deployed atomically by the factory with real native-token transfers and contract authorization.
Each action started with 17 retained stroops and received 101 more. All amounts are stroops.

| Action            | Terminal recipient payouts | Terminal retained balance | Forwarded after enabling downstream and receiving another 101 |
| ----------------- | -------------------------- | ------------------------: | ------------------------------------------------------------: |
| Pay fixed 100     | 100                        |                        18 |                                                            19 |
| Pay 50%           | 50                         |                        68 |                                                           119 |
| Split fixed 60/40 | 60 / 40                    |                        18 |                                                            19 |
| Split 60%/40%     | 60 / 41                    |                        17 |                                                            17 |

The admin setter changed each terminal action to use two next steps. The first target was a
percentage Split paying 100% to its recipient; the second target remained unused with zero
balance. Forwarding included earlier retained funds and drained the action's entire balance.
Fixed Split's accumulator reset after successful forwarding.

For **all eight trigger/mode combinations**, a prepared transaction was submitted after a
separate controller-source transaction paused the downstream Split. The submitted transaction
finalized `FAILED`. Trigger, action, downstream, unused-target, and recipient token balances
matched their pre-submit values; fixed Split accounting also rolled back. A separate 17-stroop
prefunding ensured every mode attempted downstream execution. Unpausing and retrying succeeded.
These checks concern token transfers and contract state; failed transaction fees still apply.

Additional deployed cases passed:

- Terminal fixed Split `distribute`: deposits of 30 and 80 left an accumulator and retained
  balance of 10. Recipient deltas were checked in the trigger matrix, rather than this direct case.
- Subscription `charge_by_relayer` into terminal fixed Pay and fixed Split: real token allowance,
  recipient payouts, and advancement of `next_charge_at` were checked. The isolated test signer
  filled the configured relayer role; the application's cron/channel scheduling was outside this check.

A fresh RPC query confirmed all **116 recorded chain transactions**: 108 successful setup,
deployment, mutation, or execution transactions and eight deliberately failed rollback transactions.
The total includes the initial partial harness run. That run attempted to pause a Payer, which
has no pause entry point; switching the downstream fixture to a pausable Split completed the matrix.

## Application deployment and genuine wallet signing

The unchanged application code created a standard Receive → fixed Pay flow via its API, prepared
the factory transaction, opened the real **Freighter 5.48.0** extension, accepted the wallet's
connection/signing prompts, submitted the signed transaction, and persisted a confirmed deployment.
The disposable wallet was created inside the extension; its private key was never extracted or
passed to the application. Browser automation used Chromium with the official Freighter extension.

- Deployment ID: `aa50fec0-012f-4261-be2b-5725346e29f3`.
- Factory deployment transaction: `bb9b8a8d75e0b8354c5d859ee3e663496c7195349a927c0991e1da67c690fadb`,
  confirmed at ledger **5000348**.
- Both the app review and the genuine wallet prompt showed testnet. The prepared source matched
  the connected wallet, and the invocation targeted the isolated factory's `deploy_pipeline`.
- The confirmed API response's durable `pipelineSnapshot` matched both the prepared addresses
  and the factory's actual return value, in order.

| Node | Template          | Saved and on-chain contract address                        |
| ---- | ----------------- | ---------------------------------------------------------- |
| `t`  | `DEPOSIT_TRIGGER` | `CDTZI5GZWC443EOV7ZVLLBIF5INGNQMPLMPFYJNCXEZ4ZLZK6YT4USBO` |
| `p`  | `PAYER`           | `CCDQSHCYURFLBDTIBIKYK3YD24EWOMLDL4ZV7ZG3X6MFV6QGNBAGAZT4` |

An independent ledger-entry read verified the Pay instance's executable hash and stored
`Version = 4`. The Receive instance uses the expected unchanged trigger hash and version 1.
The expanded read verified hashes of all 51 unique fixture instances, including every deployed
Pay/Split's expected stored version (v3 for baselines, v4 for changed artifacts).
The public trigger page then prepared a 100-stroop deposit, which Freighter also signed.
Transaction `77b290700555390d35d056004cbca930fe67ee45d8bd432e464a4934e09b9a41`
finalized successfully at ledger **5000474**; the recipient gained exactly 100 stroops and the
Pay contract's retained balance did not increase. The UI intentionally fixes this flow's deposit
to its configured payout; retained-fund coverage comes from the separate chain matrix above.

An optional screenshot crashed Chromium after the deployment checks had passed. Reopening the
smaller public trigger page completed the deposit check. Coverage is this wallet/version and
browser; it does not establish mobile, hardware-wallet, or every supported-wallet compatibility.

## Actual RPC simulation resources

The public RPC at `https://soroban-testnet.stellar.org` simulated both uploaded v3 and v4 artifacts.
Each comparable terminal fixture held 118 stroops and invoked `execute_step(asset, 101)` with
the same payout parameters used in the local measurements in
[§4.1.3](soroban-smart-contracts.md#413-terminal-paysplit-forwarding-797).
The account parent authorized these isolated measurement fixtures; the real trigger chains were
verified separately above.

| Mode          | RPC instructions v3 → v4 | Instructions saved | Minimum resource fee v3 → v4 (stroops) | Simulation ledger |
| ------------- | -----------------------: | -----------------: | -------------------------------------: | ----------------: |
| Pay fixed     |      1,000,383 → 955,304 |             45,079 |                        23,740 → 23,708 |           5000186 |
| Pay 50%       |        978,923 → 933,844 |             45,079 |                        23,725 → 23,693 |           5000189 |
| Split fixed   |    1,398,121 → 1,347,321 |             50,800 |                        34,259 → 34,224 |           5000192 |
| Split 60%/40% |    1,213,913 → 1,172,516 |             41,397 |                        30,806 → 30,777 |           5000195 |

These are the assembled RPC transaction data's instruction counts and the RPC's
`minResourceFee`, excluding inclusion fees. They differ from the local SDK host estimates;
they are neither measured production throughput nor a prediction of the total fee paid by every flow.
The RPC did not provide a `cost` breakdown. Footprints and byte counts were unchanged between
the corresponding v3/v4 fixtures:

| Mode                   | Disk-read bytes | Write bytes | Read-only entries | Read/write entries |
| ---------------------- | --------------: | ----------: | ----------------: | -----------------: |
| Pay fixed / percentage |             144 |         368 |                 3 |                  2 |
| Split fixed            |             288 |       1,476 |                 2 |                  4 |
| Split percentage       |             288 |         512 |                 3 |                  3 |

The eight complete nonterminal trigger-chain simulations are also recorded in the evidence:
2,982,544–3,505,931 instructions. Those use different whole-chain workloads and are not a v3/v4
comparison.

## Artifacts and activation boundary

| Artifact          | Uploaded WASM SHA-256                                              |
| ----------------- | ------------------------------------------------------------------ |
| Pay v4            | `b331db1c3e26da4fe8aec7635a567a11fb5e069123c355eaae92d095d5ef457f` |
| Split v4          | `14405917781ee8cb9476c8a43b6245a5bae033537d5c2de72dec2a7b27dabce5` |
| Pay v3 baseline   | `fb2fb73fca6d385a2bd8c6f8cddc47ef5653b29a1ddf69387b7d988eef54adce` |
| Split v3 baseline | `78e60ec76a351baeb7bc167c6eb553e3daf6f4ec5febb820d7cf970acb3fac91` |

This completes the requested deployed-chain, application/wallet, and RPC-resource rehearsal for
these artifacts. Activating hashes in a shared environment still follows
[§4.3](soroban-smart-contracts.md#43-wasm-upload-bootstrap); existing immutable instances
require separately planned redeployment. The rehearsal's factory was isolated for testing; the
application's existing factory needs no code change or redeployment for #797.
