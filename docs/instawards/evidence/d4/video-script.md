# Week 4 demo video: script and shot list

The technical walkthrough for SOW §5.1 week 4 ("Record and publish 3–5 min technical demo video"),
§6.1's validation package ("Demo video (technical walkthrough)") and §6.3's last open metric ("Demo
video published"). The same take is the human half of "End-to-end integration test with external
wallet": Freighter signs the deploy and the trigger, and a separate key acting as a partner backend
executes the same deployment through `/api/v1`. The scripted half is
`tests/e2e/d4-end-to-end.spec.ts` (#692).

**Target length:** 4:30, with a hard limit of 3:00–5:00. **One continuous take** on
[paiflow.xyz](https://paiflow.xyz). Captions are burned in, as in D3's recording.

## Before recording

### The build

- [ ] #699 (trustline message), #700 (guide links, panel docs line) and #701 are promoted to
      `staging`.
- [ ] `curl -s https://paiflow.xyz/api/health` shows `"status":"ok"` and a `version`. Write the
      version down for the record.
- [ ] `pnpm soroswap:check` passes: the XLM/USDC pool has reserves on the router.

### Accounts (testnet)

| Role                   | What it needs                                                                                   | Why                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Owner** (Freighter)  | A registered Paiflow account; Freighter on **Testnet**; ≥ 200 XLM                               | Deploys and triggers from the browser                            |
| **Recipient**          | Funded, with a **USDC trustline to `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`** | Receives the swapped USDC. Check the issuer: the wrong one fails |
| **Partner** (CLI only) | `stellar keys generate d4-partner --network testnet --fund`                                     | Plays a partner backend's depositor in the API segment           |

Check the recipient before the take:

```bash
curl -s https://horizon-testnet.stellar.org/accounts/$RECIPIENT \
  | jq '.balances[] | select(.asset_code=="USDC") | .asset_issuer'
# must print "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
```

### The screen

- [ ] Browser at 1920×1200 or 1440×900, zoom 100%, bookmarks bar hidden, notifications off.
- [ ] Tabs open in order: paiflow.xyz (signed in), a terminal with a large font, stellar.expert
      testnet.
- [ ] Terminal: `export PAIFLOW=https://paiflow.xyz FROM=$(stellar keys address d4-partner)` already
      run, and the curl lines below pasted into a scratch file ready to copy. **Don't show a secret
      key on screen.** `stellar tx sign --sign-with-key d4-partner` signs by key name.

## The take

Each segment gives the time budget, what's on screen, the caption or narration, and the claim the
segment proves.

### 1. What Paiflow is (0:00–0:25)

- **Screen:** paiflow.xyz landing, then the builder with an empty canvas.
- **Say:** "Paiflow lets you build a payment flow by dragging blocks, then deploys it to Stellar as
  smart contracts your own wallet signs. This is the Stellar testnet. In this run we build a flow
  that receives XLM, swaps it to USDC on Soroswap, and pays it out, then run it from the app and
  from a backend through the developer API."
- **Proves:** §3.8 "public testnet URL anyone can open".

### 2. Build the flow (0:25–1:15)

- **Screen:** add **On Receive** (XLM), then **Swap**, then **Pay**, and wire them together. Open
  the Swap panel: Asset In XLM, Asset Out USDC, Max slippage 1%, then type 10 in **You send**
  to move the live quote. Open **Advanced**
  to show the pinned router and its stellar.expert link. In Pay, paste the recipient.
- **Say:** "The Swap panel is built from the shared inputs: asset select, share input for slippage,
  the amount input that drives the quote, and the router pinned to the real Soroswap contract. The
  preview on the right is the flow in plain English."
- **Proves:** D1 (the swapper block is configurable), D3 (the shared inputs in the Swapper panel).

### 3. Deploy with Freighter (1:15–2:00)

- **Screen:** **Deploy** → the review page with the **TESTNET** chip → Freighter pops up → sign →
  `CONFIRMED` with the contract addresses. Click the deploy transaction: stellar.expert shows one
  `deploy_pipeline` call creating the contracts.
- **Say:** "The server builds and simulates the transaction, and my wallet signs it. The keys never
  leave the browser. One factory call deploys the whole pipeline."
- **Proves:** D1 (deploy), §5.1 week 4 (an external wallet), §3.10.

### 4. Trigger from the app (2:00–2:45)

- **Screen:** **Trigger**, 10 XLM → Freighter signs → the live event feed shows the deposit, the
  swap and the payout. On stellar.expert, the invocation tree: `deposit` → `execute_step` →
  `swap_exact_tokens_for_tokens` on the Soroswap router → the USDC payment.
- **Say:** "Ten XLM went in. The swapper called the Soroswap router, a real DEX on testnet, and
  paid the USDC on to the recipient, all in one transaction."
- **Proves:** D1 (a real swap through the router, with the tx hash).

### 5. The developer API (2:45–4:00)

- **Screen:** the deployment page → **API access** → **Create token** → copy it (blur the token in
  the edit, or revoke it after the take). The line under the intro links the guide, the OpenAPI
  spec and the Postman collection. Then the terminal:

```bash
export PAIFLOW_TOKEN=pfk_…   # pasted, blurred in the edit
export DEPLOYMENT_ID=…       # from the page URL

# 1. prepare: the server builds and simulates the deposit
curl -s -X POST $PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H "Content-Type: application/json" \
  -d "{\"amount\":\"100000000\",\"from\":\"$FROM\"}" | tee prepared.json | jq .

# 2. sign on our side: the token alone can't move funds
SIGNED=$(stellar tx sign --sign-with-key d4-partner --network testnet "$(jq -r .data.xdr prepared.json)")

# 3. submit
curl -s -X POST $PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H "Content-Type: application/json" \
  -d "{\"signedXdr\":\"$SIGNED\"}" | tee submitted.json | jq .

# 4. events
curl -s "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events?txHash=$(jq -r .data.txHash submitted.json)" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" | jq '.data.items[] | {kind, topic, txHash}'
```

- **Say:** "A partner's backend runs the same flow with a deployment token. Paiflow prepares the
  transaction and the partner signs it with its own key, so the token can't spend anyone's money.
  Submit, and the swap event comes back from the events feed."
- Then open the submitted `txHash` on stellar.expert: the same router call as in segment 4.
- **Proves:** D2 (token-scoped execute and events, a swap triggered by the API, the tx hash).

### 6. Where to check it all (4:00–4:30)

- **Screen:** the GitBook site: the handoff page, the transaction list, the integration guide.
- **Say:** "Every transaction in this video, and every other swap from the sprint, is listed with
  its stellar.expert link. The guide walks through what you just saw, with the full payloads."
- **Proves:** §6.1 validation package (guide + tx list).

### Optional: a recipient that isn't ready (+0:15, only if under 4:30)

With #699 live, trigger a second flow whose recipient has no USDC trustline. Instead of "error #13",
the trigger shows "The payout recipient has no trustline for USDC issued by GBBD47IF…". Skip this
if it would push past 5:00.

## After recording

Send back the file (or its link) and the timestamps. From these I write
`04-recording-run.json`, and the matching `04-recording-run.getTransaction.json`, in the
`d1/13` / `d3/19` style:

- the public URL (a Google Drive link set to "anyone with the link", or unlisted YouTube), the
  duration, and the file's sha256;
- `/api/health`'s `version` from before the take;
- the deployment id (from the page URL). The deploy, trigger and API tx hashes are read from it and
  from RPC;
- the start time of each segment.

Then the URL goes into `metrics.md` ("Demo video published: Yes"), the evidence index, `week-4.md`
and the handoff page (#697).
