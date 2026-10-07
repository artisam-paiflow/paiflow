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
      deployed behavior. Public live updates and embedded payment QR remain #577.
      Event Plan reconciliation remains on hold until explicitly resumed.

### Philippines mobile-data run

- [ ] From a device physically in the Philippines, disable Wi-Fi and use mobile
      data. Verify app access, wallet connection/signing, Stellar transaction
      submission and confirmation, and balance updates. Record carrier, device,
      browser/wallet, deployed commit and transaction evidence. A desktop source
      review or simulated mobile browser does not complete this check.

## Queued with upcoming work

These checks remain pending until their implementation or prerequisites are ready.
Expand the steps when the corresponding PR is prepared.

- [ ] **#577 — Public embed functionality:** verify payment QR and anonymous live
      events on the promoted app; repeat #789's credential/private-data checks for
      every new public read path.
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
