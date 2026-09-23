# The public demo token — an anonymous caller reaching `/api/v1`

**Run:** 20 September 2026, 14:42 UTC, against `https://paiflow.xyz` (Stellar testnet). No account,
no session cookie, no operator-minted credential: the only input is `curl`. This is the path SOW
§3.8 ("a public testnet URL anyone can open, try, and inspect") and §6.1 ("public URL where the API
is active") ask a reviewer to be able to walk, and it was added after D2 closed
([#554](https://github.com/artisam-paiflow/paiflow/commit/92dfa15ece75727906f12494e3d0a5fb427f6afb)).
The token below is redacted; everything else is the response as returned.

The demo route is pinned to the same deployment as the [18 September curl
run](01-curl-transcript.md), so the events it returns are that run's real swap.

## 1. Ask for a token — no credential of any kind

```bash
curl -X POST https://paiflow.xyz/api/v1/demo-token
```

`201 Created`, `x-request-id: mu9xdspl-ojdjyl`:

```json
{
  "data": {
    "deploymentId": "ad0843d9-f6de-422f-b216-717caa92aa8a",
    "token": "pfk_734877f8…REDACTED",
    "expiresAt": "2026-09-20T15:42:26.894Z"
  }
}
```

The token lasts sixty minutes and reaches that one deployment. It is an ordinary
`DeploymentApiToken` row, so it authenticates on exactly the path an operator-minted token does.

## 2. Use it on the events endpoint

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://paiflow.xyz/api/v1/deployments/ad0843d9-f6de-422f-b216-717caa92aa8a/events?limit=2"
```

`200 OK` — `{ items, nextCursor, hasMore }`, oldest first, with the opaque cursor:

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
      }
    ],
    "nextCursor": "NDczNTAzMHwwMDIwMzM2Nzk4OTk1NjIzOTM2LTAwMDAwMDAwMTA",
    "hasMore": true
  }
}
```

The second item is the `PAYOUT` / `pay` event of the same transaction (elided above for length).
`txHash` is the D2 evidence swap,
[`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7).

## 3. Without the token, the same request is refused

```bash
curl "https://paiflow.xyz/api/v1/deployments/ad0843d9-f6de-422f-b216-717caa92aa8a/events?limit=1"
```

`401 Unauthorized`:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "A valid API token for this deployment is required"
  }
}
```

So the demo route opens the API to an anonymous reviewer without opening the deployment routes
themselves: they still take a bearer token, and the refusal is the same generic one every other
rejection returns.

## What this does not show

Executing a swap through the demo token needs a funded testnet key to sign the deposit, which curl
cannot do — the API never signs. The [curl transcript](01-curl-transcript.md) and the
[Postman run](09-postman-run.png) cover that path. Note also that the demo deployment is **shared**:
its swap proceeds are paid to a Paiflow-owned testnet account, so anything deposited into it is
spent, and any other demo-token holder can read the events a deposit produces. The developer guide's
[Trying the API](../../../api/README.md#trying-the-api) says so before the first command.
