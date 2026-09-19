# D2 curl transcript — an API-executed swap on paiflow.xyz

**Run:** 18 September 2026, 02:31:52–02:32:17 UTC, against `https://paiflow.xyz` (Stellar testnet).
The sequence follows the [developer guide's quick start](../../../api/README.md#quick-start):
curl prepare → `stellar tx sign` on the operator's machine → curl submit → curl events. The API
token is redacted; it was minted in the deployment's API access panel and is the only credential
on every request (no session cookie). The depositor's secret key never left the operator's
machine — the CLI signs with a local key alias.

|                    |                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Deployment         | `ad0843d9-f6de-422f-b216-717caa92aa8a` (`Receive XLM → Swap → Pay USDC`)                                                                   |
| Depositor (`from`) | [`GCMAIV7N…ZVUM`](https://stellar.expert/explorer/testnet/account/GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM)                |
| Deposit trigger    | [`CCO4SUZW…7HT5`](https://stellar.expert/explorer/testnet/contract/CCO4SUZWNBHIPCADMBCLWO4YOSLWFUDDUUMBYCQF6HRHIX3FBHDI7HT5)               |
| Swapper contract   | [`CD767KMX…YK46`](https://stellar.expert/explorer/testnet/contract/CD767KMX45WW43PTNBHP2D2MHR4633XVBY53UKIVX5LPZYRTED6RYK46)               |
| Payer contract     | [`CDGWKFVY…WRIX`](https://stellar.expert/explorer/testnet/contract/CDGWKFVYWL5Z6QB7KIOBHJLAEK4DGDV7WG4IRMPXWYKCCG76466UWRIX)               |
| Swap transaction   | [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7), ledger 4735030 |
| Result             | 10 XLM → 1.0584167 USDC through the Soroswap router, paid to `GCVJW2CE…2J7H`                                                               |

## Setup

```bash
export PAIFLOW=https://paiflow.xyz
export DEPLOYMENT_ID=ad0843d9-f6de-422f-b216-717caa92aa8a
export PAIFLOW_TOKEN=pfk_REDACTED
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
    "expiresAt": "2026-09-18T02:34:52.000Z"
  }
}
```

Saved as [`02-prepare-response.json`](02-prepare-response.json): the unsigned envelope. `expiresAt`
is about three minutes out, so the next two steps have to follow promptly.

## 2. Sign, locally

```bash
stellar tx sign --sign-with-key d2-depositor --network testnet \
  "$(jq -r .data.xdr 02-prepare-response.json)" > signed.xdr
```

```text
ℹ️  Signing transaction: b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7
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
    "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
    "status": "SUCCESS",
    "ledger": 4735030
  }
}
```

Saved as [`03-submit-response.json`](03-submit-response.json). The hash matches the one the CLI
printed when signing. The raw `getTransaction` for it is
[`04-getTransaction.json`](04-getTransaction.json); its contract events show the deposit into the
trigger, the swapper's call into `SoroswapRouter` (`swap` event from
[`CCJUD55A…7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD))
and the Soroswap pair, and the payer's `pay` to the recipient. The three audit rows the run wrote —
prepared, submitted, confirmed — are in [`06-audit-rows.json`](06-audit-rows.json).

## 4. Poll events

Filtered to the run's transaction:

```bash
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?txHash=b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7&limit=100" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

```json
{
  "data": {
    "items": [
      {
        "id": "167054b2-8cb6-4055-b8fd-4a7ca190c002",
        "eventId": "0020336798995623936-0000000001",
        "kind": "RECEIVE",
        "topic": "deposit",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "from": "GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM",
          "asset": "XLM",
          "amount": "100000000"
        }
      },
      {
        "id": "c579376d-7cdc-4d22-a3b1-be49c3b2972b",
        "eventId": "0020336798995623936-0000000010",
        "kind": "PAYOUT",
        "topic": "pay",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "asset": "USDC",
          "payment": "10584167",
          "recipient": "GCVJW2CEXCJ6WPRYAMYFIDA6LLIYX5NJIJ6T76NW2BXQXFNPV2V62J7H"
        }
      },
      {
        "id": "94cf0bbf-54a6-43c7-9e55-d48a6b688ac7",
        "eventId": "0020336798995623936-0000000011",
        "kind": "PAYOUT",
        "topic": "swap",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "assetIn": "XLM",
          "amountIn": "100000000",
          "assetOut": "USDC",
          "amountOut": "10584167"
        }
      }
    ],
    "nextCursor": "NDczNTAzMHwwMDIwMzM2Nzk4OTk1NjIzOTM2LTAwMDAwMDAwMTE",
    "hasMore": false
  }
}
```

The three events the pipeline emitted, oldest first: the deposit into the trigger, the payer's
payout, and the swap itself with the amounts in and out. `kind` is the app's own classification and
`topic` is the contract event's first topic, so a swap reads as `kind: "PAYOUT"`, `topic: "swap"`.

The same feed paged forward with the opaque cursor, two at a time:

```bash
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?limit=2" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN"
```

```json
{
  "data": {
    "items": [
      {
        "id": "167054b2-8cb6-4055-b8fd-4a7ca190c002",
        "eventId": "0020336798995623936-0000000001",
        "kind": "RECEIVE",
        "topic": "deposit",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "from": "GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM",
          "asset": "XLM",
          "amount": "100000000"
        }
      },
      {
        "id": "c579376d-7cdc-4d22-a3b1-be49c3b2972b",
        "eventId": "0020336798995623936-0000000010",
        "kind": "PAYOUT",
        "topic": "pay",
        "ledger": 4735030,
        "txHash": "b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7",
        "occurredAt": "2026-09-18T02:32:17.000Z",
        "data": {
          "asset": "USDC",
          "payment": "10584167",
          "recipient": "GCVJW2CEXCJ6WPRYAMYFIDA6LLIYX5NJIJ6T76NW2BXQXFNPV2V62J7H"
        }
      }
    ],
    "nextCursor": "NDczNTAzMHwwMDIwMzM2Nzk4OTk1NjIzOTM2LTAwMDAwMDAwMTA",
    "hasMore": true
  }
}
```

Passing that `nextCursor` back returns the remaining event with `hasMore: false`. Passing the
cursor the feed ended on returns nothing and echoes the cursor straight back:

```json
{
  "data": {
    "items": [],
    "nextCursor": "NDczNTAzMHwwMDIwMzM2Nzk4OTk1NjIzOTM2LTAwMDAwMDAwMTE",
    "hasMore": false
  }
}
```

That is how a partner tails the feed: keep the last `nextCursor`, poll with it, and an empty
`items` means nothing new rather than a reset. All four responses are saved in
[`05-events-response.json`](05-events-response.json).
