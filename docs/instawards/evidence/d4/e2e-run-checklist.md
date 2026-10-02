# End-to-end run with an external wallet: checklist

> **Recorded 28 September.** The recording and its record are in the
> [D4 evidence pack](README.md#the-freighter-run-28-september).

SOW §5.1 week 4: "End-to-end integration test with external wallet". This is the human half. It
needs a real wallet (Freighter), signing through the app on the current build, in one unedited
screen recording. The scripted half is [`01`–`03-e2e-*`](README.md). The technical walkthrough
is a separate video ([`walkthrough-script.md`](walkthrough-script.md)).

No narration or editing is needed, and there's no length limit. The recording only has to show
each step below, in order, without cuts.

## Before recording

- [ ] Freighter installed, switched to **Testnet**, and funded with ≥ 50 XLM.
- [ ] Signed in on [paiflow.xyz](https://paiflow.xyz) as **a non-tester account**, so the run
      doesn't count in the alpha cohort.
- [ ] A recipient with a USDC trustline to
      `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. `d4-recipient`
      (`stellar keys address d4-recipient`) is ready.
- [ ] For the API step: a terminal with `stellar keys` holding a funded key (`d4-partner` is
      ready), plus `curl` and `jq`. Never show a secret key on screen.

## The eight shots

1. **The build.** Open `https://paiflow.xyz/api/health` so `version` is readable.
2. **The wallet.** Open Freighter with **Testnet** and the account address visible.
3. **Build** On Receive (XLM) → Swap (XLM → USDC) → Pay (USDC, the recipient) in the builder.
4. **Deploy.** DEPLOY, then the review page with the **TESTNET** chip, then **Freighter's signing
   popup** approved, then the confirmed deployment with its contract addresses.
5. **The deploy transaction** on stellar.expert.
6. **Trigger** from the deployment page: **Freighter's popup** approved, then the live event feed
   showing deposit, swap and payout.
7. **The trigger transaction** on stellar.expert: the invocation tree with the Soroswap router
   call and the USDC transfer to the recipient.
8. **The API leg** on the same deployment. API access → CREATE TOKEN (blur the token or revoke it
   afterwards). Then in the terminal: prepare → `stellar tx sign --sign-with-key d4-partner` →
   submit → events, following the [integration guide](../../../guide/README.md#4-run-the-same-deployment-from-a-backend).
   Finish with that transaction on stellar.expert.

## After recording

Send the recording's link (Drive "anyone with the link", or unlisted YouTube), the deployment id
(the end of the deployment page's URL) and rough timestamps for shots 4, 6 and 8. From those, I
write `04-e2e-wallet-run.json` and its `getTransaction` record, as D1's `13` and D3's `19` were
done.
