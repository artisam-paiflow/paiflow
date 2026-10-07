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

## Queued with upcoming work

These checks remain pending until their implementation or prerequisites are ready.
Expand the steps when the corresponding PR is prepared.

- [ ] **#790 — Wallet-only subscription approval:** verify logged-out customer and
      Dev subscription approval using real wallet signing; confirm on-chain
      allowance and subsequent expected charge behavior.
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
