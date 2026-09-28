# Integration guide

This guide takes one payment flow all the way through Paiflow on Stellar testnet. You'll build it in
the browser, deploy it with your own wallet, run it from the app, then run the **same** deployment
from a backend with `curl`. You end with three transactions you can open on stellar.expert: the
deploy, a swap run from the app, and a swap run through the API. Allow about fifteen minutes.

The flow is **Receive XLM → Swap to USDC on Soroswap → Pay**. It's the flow every deliverable of the
Instawards sprint was proven on, so every step here has a recorded run to compare against.

{% hint style="warning" %}
**Testnet only.** [paiflow.xyz](https://paiflow.xyz) runs on Stellar testnet. Nothing here moves
real money, and every account, asset and amount below is a testnet one.
{% endhint %}

For the API's full reference (every field, error code and rate limit) see the
[Developer API](../api/README.md). This guide links there rather than repeating it.

## What you need

| Tool or account                                                                     | Used for                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------- |
| [Freighter](https://www.freighter.app/), switched to **Testnet**, funded            | Signing the deploy and the in-app trigger |
| A Paiflow account on [paiflow.xyz](https://paiflow.xyz)                             | Deployment tokens need an owner           |
| A **recipient** account with a USDC trustline (see below)                           | Receiving the swapped USDC                |
| The [`stellar` CLI](https://developers.stellar.org/docs/tools/cli), `curl` and `jq` | The backend steps                         |

**The recipient must trust the right USDC.** The flow pays out Circle's testnet USDC, issuer
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. A trustline to any other USDC fails the
same way as having none. To make a recipient from scratch:

```bash
stellar keys generate recipient --network testnet --fund
stellar tx new change-trust --source recipient --network testnet \
  --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
stellar keys address recipient   # paste this into the Pay block
```

## 1. Build the flow

Open [paiflow.xyz](https://paiflow.xyz), sign in, and create a flow. From the palette, add:

1. **On Receive**, asset **XLM**. This is the deposit trigger: the contract that receives the money
   and starts the flow.
2. **Swap**, **Asset In** XLM, **Asset Out** USDC, **Max slippage** 1%. Type an amount in **You
   send** to see a live quote from the Soroswap pool. **Advanced** shows the router the swap will
   call: the real Soroswap testnet router, pinned, with a link to it on stellar.expert.
3. **Pay**, asset USDC, the recipient's address, paying the full amount it receives.

Connect them in that order. The preview beside the canvas reads the flow back as a sentence, and any
problem (the same asset on both sides of the swap, a max slippage under Soroswap's 0.3% pool fee, a missing connection)
shows under the field that causes it.

## 2. Deploy it with your wallet

Press **DEPLOY**. The review page shows what will be created and a **TESTNET** chip.

- Paiflow's server **builds and simulates** the transaction, but it never holds your key.
  Freighter shows the transaction and you sign it in the browser.
- One transaction deploys the whole flow. It is a single `deploy_pipeline` call to Paiflow's factory
  contract, which creates the three contracts (trigger, swapper, payer) and wires each one to the
  next.

When it confirms, the deployment page lists the contract addresses and links the deploy transaction.
On stellar.expert, that transaction shows the factory call and the three contracts it created, each
running one of Paiflow's fixed template binaries. The swapper's is
[WASM `e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a).

## 3. Run it from the app

On the deployment page, enter an amount (10 XLM is plenty) and trigger. Freighter signs a `deposit`
into the trigger contract, and the live event feed shows the deposit, the swap and the payout as they
land.

On stellar.expert, open the transaction and look at its invocation tree:

```text
deposit                                  the trigger contract takes your XLM
└─ execute_step                          the swapper
   ├─ swap_exact_tokens_for_tokens       the Soroswap router: XLM → USDC
   ├─ transfer                           USDC, swapper → payer
   └─ execute_step                       the payer
      └─ transfer                        USDC → the recipient
```

The tree is abridged: the asset contracts' own calls are left out.

It's one transaction. If any step fails (the pool moved past your slippage, or the recipient
can't hold USDC), the whole thing reverts and no money moves.

## 4. Run the same deployment from a backend

A partner backend runs the flow through `/api/v1` with a **deployment token**. The token can prepare,
submit and read events for this one deployment and nothing else. It can't move money on its own:
every deposit is still signed by the depositor's key, on the partner's side.

### Get a token

On the deployment page, open **API access**, give the token a label and an expiry, and press
**CREATE TOKEN**. Copy it now; it's shown once. The same panel links the reference, the OpenAPI
spec and the Postman collection.

```bash
export PAIFLOW=https://paiflow.xyz
export DEPLOYMENT_ID=…            # the deployment page's URL ends with it
export PAIFLOW_TOKEN=pfk_…        # from the panel
stellar keys generate partner --network testnet --fund   # the depositor, on your side
export FROM=$(stellar keys address partner)
```

### Prepare → sign → submit → events

```bash
# 1. Prepare: Paiflow builds and simulates the deposit, and returns it unsigned
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H "Content-Type: application/json" \
  -d "{\"amount\":\"100000000\",\"from\":\"$FROM\"}" > prepared.json

# 2. Sign it yourself, with the network passphrase the response names
stellar tx sign --sign-with-key partner --network testnet \
  "$(jq -r .data.xdr prepared.json)" > signed.xdr

# 3. Submit: Paiflow relays it and waits for the result
curl -sS -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H "Content-Type: application/json" \
  -d "{\"signedXdr\":\"$(cat signed.xdr)\"}" | tee submitted.json | jq .data

# 4. Read what the flow did, by transaction
curl -sS "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?txHash=$(jq -r .data.txHash submitted.json)" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" | jq '.data.items[] | {kind, topic}'
```

`amount` is in stroops: 100000000 is 10 XLM. The prepared envelope is valid for 180 seconds
(`expiresAt` in the response), so steps 2 and 3 have to follow promptly. Submitting the same signed
envelope twice is safe: the second call reports on the first rather than running the flow again.
The events feed pages forward with a cursor; the reference covers
[polling](../api/README.md#4-poll-events).

## 5. Sample payloads

These are the real envelopes from the 18 September evidence run on deployment `ad0843d9`: 10 XLM,
swapped to 1.0584167 USDC in
[`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7).
The whole run, with every response, is the
[D2 curl transcript](../instawards/evidence/d2/01-curl-transcript.md).

### The prepared envelope, decoded

Decode any envelope yourself with
`stellar xdr decode --type TransactionEnvelope --output json-formatted`, or paste it into
[Stellar Lab](https://lab.stellar.org/xdr/view). The parts that matter:

```json
{
  "source": "GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM",
  "time_bounds": { "min_time": "0", "max_time": "1789698892" },
  "operation": {
    "invoke_contract": {
      "contract_address": "CCO4SUZWNBHIPCADMBCLWO4YOSLWFUDDUUMBYCQF6HRHIX3FBHDI7HT5",
      "function_name": "deposit",
      "args": [
        { "address": "GCMAIV7NW6C5KT5VGSHCBD5VQE4XAM2PDFZVICHDVDWL2BKE7BJYZVUM" },
        { "i128": "100000000" }
      ]
    }
  },
  "auth": {
    "root": "deposit on CCO4SUZW…7HT5",
    "sub_invocations": [
      {
        "contract_address": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        "function_name": "transfer"
      }
    ]
  }
}
```

Read it as: `from` calls `deposit(from, 10 XLM)` on this deployment's trigger contract. The only
thing it authorises beyond that is one `transfer` on the XLM asset contract (`CDLZFC3S…CYSC`), the
deposit itself. `max_time` is the 180-second window. Simulation has already filled in the footprint
and the fee, so the envelope is ready to sign as it is. The server refuses to relay anything else:
a submitted envelope must hold exactly this one `deposit` call on this deployment's trigger.

<details>

<summary>The prepared (unsigned) envelope, in full</summary>

```text
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
```

</details>

<details>

<summary>The same envelope, signed</summary>

Identical up to the last few bytes: signing appends one signature (the `from` key's hint and 64
signature bytes) and changes nothing else. So signing on your side can't alter what the server
prepared, and the server can't alter what you signed.

```text
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
```

</details>

## 6. When something goes wrong

| What you see                                                                         | Why                                                                   | Fix                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| "The payout recipient has no trustline for USDC issued by GBBD47IF…"                 | The recipient can't hold that USDC, so the payout leg reverts         | Add a trustline to **that** issuer ([What you need](#what-you-need)), then trigger again |
| "Soroswap would return less than the minimum allowed by the swap's slippage setting" | The pool moved further than the flow's max slippage allows            | Try again, swap less, or deploy with a higher max slippage                               |
| `402 INSUFFICIENT_FUNDS` from prepare                                                | `from` doesn't exist on testnet                                       | Fund it (`stellar keys generate … --fund`, or friendbot)                                 |
| `200` with `status: FAILED`, `code: txTooLate`                                       | More than 180 seconds passed between prepare and submit               | Prepare again and sign straight away                                                     |
| `401 UNAUTHENTICATED`                                                                | The token is missing, revoked, expired, or for a different deployment | Create a new token on this deployment's API access panel                                 |
| `422` on submit, "must call deposit"                                                 | The envelope isn't this deployment's single `deposit` call            | Submit the envelope prepare returned, signed and otherwise unchanged                     |

The [Developer API reference](../api/README.md#errors) lists every error code.

## Where to go next

- [Developer API](../api/README.md): the full reference, the OpenAPI spec and the Postman collection.
- [Transaction list](../instawards/evidence/transactions.md): every swap the public app has run, on
  stellar.expert.
- [How to verify the router](../instawards/evidence/README.md#how-to-verify-the-router): check that
  a swap really went through Soroswap.
