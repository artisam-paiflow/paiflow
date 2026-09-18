# D2 curl transcript — an API-executed swap on paiflow.xyz

**Run:** 15 September 2026, 08:23:58–08:24:04 UTC, against `https://paiflow.xyz` (Stellar testnet).
The sequence follows the [developer guide's quick start](../../../api/README.md#quick-start):
curl prepare → `stellar tx sign` on the operator's machine → curl submit → curl events. The API
token is redacted; it was minted in the deployment's API access panel and is the only credential
on every request (no session cookie). The depositor's secret key never left the operator's
machine — the CLI signs with a local key alias.

|                    |                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Deployment         | `0786fca6-ed7c-405b-a819-6aaae424c215` (`Receive XLM → Swap → Pay USDC`)                                                                   |
| Depositor (`from`) | [`GCMAIV7N…ZVUM`](https://stellar.expert/explorer/testnet/account/GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM)                |
| Swapper contract   | [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE)               |
| Swap transaction   | [`5b1e738f…`](https://stellar.expert/explorer/testnet/tx/5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be), ledger 4687411 |
| Result             | 10 XLM → 1.0547687 USDC through the Soroswap router, paid to `GAEBH5ZA…SXAM`                                                               |

## Setup

```bash
export PAIFLOW=https://paiflow.xyz
export DEPLOYMENT_ID=0786fca6-ed7c-405b-a819-6aaae424c215
export PAIFLOW_TOKEN=pfk_REDACTED
stellar keys generate d2-depositor --network testnet --fund
export FROM=$(stellar keys address d2-depositor)   # GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM
```

## 1. Prepare

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"amount\":\"100000000\",\"from\":\"$FROM\"}" > 02-prepare-response.json
```

```json
{
  "data": {
    "xdr": "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",
    "networkPassphrase": "Test SDF Network ; September 2015",
    "network": "testnet",
    "expiresAt": "2026-09-15T08:26:59.000Z"
  }
}
```

Saved as [`02-prepare-response.json`](02-prepare-response.json): the unsigned envelope.

## 2. Sign, locally

```bash
stellar tx sign --sign-with-key d2-depositor --network testnet \
  "$(jq -r .data.xdr 02-prepare-response.json)" > signed.xdr
```

```text
ℹ️  Signing transaction: 5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be
```

The signed envelope:

```text
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
```

## 3. Submit

```bash
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"signedXdr\":\"$(cat signed.xdr)\"}" > 03-submit-response.json
```

```json
{
  "data": {
    "txHash": "5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be",
    "status": "SUCCESS",
    "ledger": 4687411
  }
}
```

Saved as [`03-submit-response.json`](03-submit-response.json). The hash matches the one the CLI
printed when signing. The raw `getTransaction` for it is
[`04-getTransaction.json`](04-getTransaction.json); its contract events show the deposit into the
trigger, the swapper's call into `SoroswapRouter` (`swap` event from
`CCJUD55A…7BRD`), and the payer's `pay` to the recipient. The three audit rows the run wrote —
prepared, submitted, confirmed — are in [`06-audit-rows.json`](06-audit-rows.json).

## 4. Poll events

TODO(#471): not captured. On the day of the run `GET …/events` returned no items — the event
poller was stuck on a stale cursor (#483), so the swap was on chain but not yet in the app's
record. That defect is fixed (#484) and live, but this run can no longer supply the capture:
its deployment, token and event rows are in the database the public app used until
16 September, a read-only archive since the beta cutover. The events response comes from a
fresh run on the live database instead.
