# Manual verification queue after branch promotion

This is the running checklist for the hackathon readiness work. Run the applicable
checks after `hackathon-staging` is promoted to the agreed deployed environment.
Merging a PR, passing CI, or reviewing source does not complete a live check.
No target environment or promotion is selected or authorized by this checklist.

For each run, record the environment and app URL, deployed commit, date, tester,
outcome, and evidence link. Keep credentials, cookies, wallet secrets and signed
transaction envelopes out of evidence. Check off an item only after execution;
record failures and blockers beside it. Reopen affected items after a later change
or promotion requires retesting, preserving links to previous evidence.

## Ready for verification after promotion

### Wallet cancellation — #808 / PR #831

Hosted candidate: <https://pinkraft-prod.up.railway.app>, testnet, full promotion
commit `c1db0a8c290e03d8ef15f37ac53e218aed8a9b11` (#837). User-reported desktop
results on 7 October 2026 cover the visible cancellation message and reopening the
signing prompt on retry. Later session records also report DB/log/PostHog
corroboration: four signing failures classified user_rejected, one error_shown
each, and no submit/status-poll/signed-transaction records. This is recorded
historical completion; the temporary evidence files were unavailable during the
10 October reconciliation, and it is not fresh beta verification. Reported clock
times are approximate; timezone and browser/wallet versions were not independently
confirmed. See issue #808's 10 October verification reconciliation.

- [x] Desktop Freighter deployment: user reported cancellation message and retry
      working at approximately 9:25.
- [x] Desktop Freighter payment/trigger: user reported completing rejection,
      cancellation-message and retry checks at approximately 9:29.
- [x] Recorded 7 October desktop analytics: `deploy_failed` / `trigger_failed` with
      `stage: sign` and `error_class: user_rejected`, plus matching `error_shown`.
      Session records report no submission or confirmation polling for these
      rejected attempts. Historical corroboration and evidence limits are
      described above; current-beta checks remain separate.
- [ ] **Deferred at the user's request, 7 October 2026 — mobile WalletConnect
      deployment cancellation.** Resume only when requested: connect a real mobile
      wallet on testnet, reject the signing request, verify “Transaction cancelled
      in your wallet.” and retry reopening signing, then reject again. Verify
      cancellation analytics and no submission/polling; record device, browser,
      wallet/version, deployed commit, time/timezone and sanitized evidence.
- [ ] **Deferred at the user's request, 7 October 2026 — mobile WalletConnect
      payment cancellation.** Repeat the same rejection/retry, analytics and
      no-submission checks on the payment/trigger screen. Closing a picker or
      allowing a connection to expire does not complete signing cancellation.

### Public embed security — #789 / PR #836

Use an isolated testnet HTTP Webhook → Pay/Split deployment and controlled team
accounts. The local checks described in [the security runbook](../public-embed-security.md)
are prior evidence, not a completed deployed-environment run.

- [ ] Confirm the deployed commit includes #836 before testing.
- [ ] Open the embed anonymously, as another team, as a sandbox user where enabled,
      and as the owner. Inspect visible UI, delivered HTML/RSC, browser component
      data and network responses. Confirm webhook credentials, private node
      configuration, contact/KYC/bank data and raw event payloads are absent. Do
      not save any actual credential in evidence.
- [ ] Confirm the graph and recorded activity render without owner controls,
      private API polling, callbacks or transaction submission during viewing.
- [ ] On the authenticated owner page, obtain/copy the webhook URL and secret;
      confirm another team cannot access that page or its private deployment API.
- [ ] On the isolated fixture, submit callbacks with missing and incorrect
      secrets. Confirm rejection and no payout.
- [ ] Rehearse the pre-funded Web2 rewards example: a controlled server sends an
      authorized callback, the intended recipient receives the expected testnet
      payout, and recorded activity and balances match the confirmed transaction.
- [ ] Inventory deployments served by an affected build and assess potentially
      exposed credentials. Record remediation requirements without credentials.
      Follow the [recovery runbook](../public-embed-security.md); replacement does
      not revoke an old secret. Credential recovery and infrastructure changes
      require their own execution authorization.
- [ ] Reconcile participant and external starter/AI guidance with the verified
      deployed behavior. Repeat these checks for the new #577 public read paths.
      Event Plan reconciliation remains on hold until explicitly resumed.

### Philippines mobile-data run

- [ ] From a device physically in the Philippines, disable Wi-Fi and use mobile
      data. Verify app access, wallet connection/signing, Stellar transaction
      submission and confirmation, and balance updates. Record carrier, device,
      browser/wallet, deployed commit and transaction evidence. A desktop source
      review or simulated mobile browser does not complete this check.

### Public embed functionality — #577

Run after a build containing #577 is promoted. See
[public embed live reads](../public-embed-live.md) for endpoints and limits.

- [ ] Open a donation/dues Receive → Pay/Split embed in a clean anonymous browser
      and another team's browser. Confirm the payment-page QR renders, scans to
      the same platform's customer page, and requires no Paiflow login or API token.
- [ ] Pay with a separate real wallet/browser and confirm the intended on-chain
      payout appears in the embed without reloading. Reconnect/reload and confirm
      no duplicate events, including multiple payouts in one transaction.
- [ ] Repeat #789's HTML/RSC/network private-data checks for initial history,
      SSE snapshots and JSON catch-up. Confirm owner APIs/mutations remain protected
      and the omitted balance panel produces no authentication error.
- [ ] Verify webhook/streamer QR links are labeled as funding and do not imply
      automatic reward execution or stream release. Confirm subscription, scheduled
      and other unsupported pipeline roots have no payment QR.
- [ ] Exercise stream disconnect/reconnect, periodic fallback and 429 backoff;
      close/hide viewers and verify subscribers/connection slots are released.
      Verify healthy shared Redis and multi-replica caps with the intended shared-IP
      audience; record any outage fallback limits.
- [ ] Synchronize participant PDF and all external starter/sample AI context
      copies with verified promoted behavior; keep Event Plan reconciliation on hold.

### Wallet-only subscription approval — #790

Run after a build containing #790 is promoted. See
[wallet-only subscription approval](../subscription-allowance.md) for the route
boundary and recovery behavior. Local tests do not complete this rehearsal.

- [ ] Confirm the promoted commit, environment network, funded relayer and RPC
      configuration. Check #792's SDK ledger-read compatibility in this app,
      including latest-ledger and ledger-close-time reads.
- [ ] In a fresh logged-out browser, open a confirmed ordinary subscription's
      `/allowance/:id` page without a deployment token. Confirm network, token,
      subscription spender and configured subscriber; sign with that wallet,
      observe confirmation and verify the cumulative allowance on chain.
- [ ] Repeat with `SUBSCRIPTION_DEV`: first leave the subscriber unconfigured and
      check the setup message, then fill it through the authenticated team's
      **Dev values**. Change it to another test wallet and verify the old wallet
      is refused and the new one can approve. Recheck a configuration change
      between preparation and submission.
- [ ] Refuse a different wallet, wrong network, tampered/extra operations and a
      cross-deployment intent. Confirm no unintended transaction was sent. Use
      controlled test fixtures and retain only public hashes as evidence.
- [ ] Lose the submit response or interrupt connectivity; reload and reconcile
      the same approval hash. Verify no second approval while finality is unknown,
      successful catch-up, and safe retry after ledger-proven expiry. An RPC or
      ledger-decoding failure must preserve the unknown outcome.
- [ ] With ordinary and Dev subscriptions, wait for the actual scheduled charge
      and verify the recipient payout, allowance reduction and visible activity
      against public transaction hashes and balances. Approval alone is not a payout.
- [ ] Verify deliberate public limits and signer attribution without attributing
      anonymous customer consent to the deployment owner. Confirm general
      invocation, charging, cancellation, Dev mutations and payroll approval
      retain their existing guards and sandbox exclusions.
- [ ] Reconcile the participant PDF and external Mechanics/AI/starter/sample
      copies with the verified promoted journey. Keep Event Plan reconciliation
      on hold until explicitly resumed.

## Queued with upcoming work

These checks remain pending until their implementation or prerequisites are ready.
Expand the steps when the corresponding PR is prepared.

- [ ] **#726 — Team provisioning:** verify all 36 funded wallets have the intended
      Paiflow accounts/logins and teams can sign in to their own accounts.
- [ ] **#770 — Starter rehearsal:** run the supplied starter against the promoted
      app with real Freighter signing and verify the qualifying payout end to end.
- [ ] **#727 — Operations:** verify on-call readiness, deployed replica/funding
      configuration and actual scheduler execution; record evidence and unresolved
      operational limits.
- [ ] **#716 — Context pack:** test the participant context with Claude, ChatGPT,
      and Copilot or Cursor; compare generated integration steps with behavior
      verified on the promoted app and synchronize guidance.

## Run log

No post-promotion runs have been recorded in this checklist yet.

| Date | Environment / URL | Deployed commit | Check | Tester | Outcome / evidence |
| ---- | ----------------- | --------------- | ----- | ------ | ------------------ |
