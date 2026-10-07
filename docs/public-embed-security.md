# Public embed security and webhook recovery

Issue: [#789](https://github.com/webnxt-2030/pinkraft/issues/789).

Public deployment embeds use a separate read-only view. The server selects no
webhook secret, owner record or API token. Internal pipeline metadata determines
payment-page eligibility in #577 and is never serialized to viewers. Before rendering,
`projectPublicEmbed` constructs an explicit display projection: graph node labels
and roles, edges and branch labels, deployment/contract/network identifiers, and
recent event identity, kind, ledger, transaction hash, timestamp and a validated
integer amount where present. Full graph configs, notification contacts, sender
KYC, bank details, recipient labels, raw event payloads and decoded metadata are
never passed to the public view or client canvas.

Every viewer of the embed receives this public projection, including logged-in
owners, other teams and sandbox users. The authenticated owner deployment page
retains webhook URL/secret access and owner controls. Missing or incorrect callback
secrets still fail before relayer execution. Viewing an embed performs no callback,
relayer execution, owner API polling or mutation.

The original #789 change provided recorded history only. The follow-up #577 uses
the same event projection for public streaming and catch-up, and adds only a
customer payment-page QR. See [public embed live reads](public-embed-live.md).
The participant context pack distinguishes source behavior from deployed readiness;
Event Plan reconciliation remains on hold. No live wallet/rewards rehearsal is
claimed by the local tests.

## Local verification — 7 October 2026

- Typecheck and production build passed; all 3,380 tests in 231 files passed
  using disposable PostgreSQL/Redis and exact locked dependencies.
- A synthetic confirmed HTTP Webhook → Pay deployment was served by the real
  local Next.js app. Eight HTML/RSC responses (anonymous, other-team, sandbox
  and owner viewers) omitted synthetic secret, contact, KYC, bank and private
  event/pipeline markers. The authenticated owner page retained the credential;
  another team's owner-page request returned 404.
- Three hydrated Chromium contexts (anonymous, other-team and sandbox) rendered
  the two-node graph and recorded activity without private deployment API reads.
  Missing/incorrect webhook secrets returned 403. The authorized callback path
  is covered with a mocked relayer in the unit suite; no on-chain callback was
  submitted in this verification.
- On the original base, `pnpm audit` reported an existing high-severity `sharp` advisory
  (`GHSA-wq5f-xc86-pv6w`) in the unchanged base lockfile. The patch adds no
  dependency or audit exception. PR #832 subsequently fixed this advisory on
  `hackathon-staging`; the security patch has been rebased onto that updated base.

## Assess previously exposed credentials

The previous implementation serialized `Deployment.webhookSecret` through the
public owner-view component. Treat webhook-enabled deployments served by an
affected build as potentially exposed, even if nobody reported using the link.
The secret could be present in HTML/RSC data as well as the visible field. Access
logs cannot prove that a credential stayed private. This is a source-based
assessment; this change does not inventory live deployments, investigate abuse,
rotate credentials or alter live infrastructure.

After rolling out the fix, the maintainer should identify affected deployments
and coordinate recovery with each owner. Keep credentials and signed envelopes
out of issue comments, logs and evidence files.

There is currently no supported in-place webhook secret rotation/revocation API.
Do not describe an arbitrary database edit as the recovery procedure. A replacement
confirmed HTTP Webhook deployment receives a newly generated secret through the
existing deployment-confirmation path:

1. Pause the team's callback sender and stop funding the affected deployment.
2. Review public transaction history and reconcile the app's reward accounting.
   Recover or settle the old pool through a supported owner path where available
   before abandoning it; some graphs do not provide such a path.
3. Create and confirm a replacement deployment using the normal owner/wallet flow.
   Obtain its new secret only from the authenticated owner page.
4. Update the team's server-side deployment URL and secret configuration. Verify
   the replacement embed omits the credential, incorrect/missing callback secrets
   fail, and an authorized testnet callback pays the intended recipient.
5. Direct customers/judges to the replacement embed and keep the old deployment
   unfunded. A new deployment does **not** revoke the old deployment's secret;
   anyone holding the old credential may still trigger any funds left there.
   If funds cannot be recovered or in-place revocation is required, track and
   authorize that additional remediation before claiming recovery is complete.

Deployment replacement, funding/recovery transactions, server configuration and
any future revocation operation require their own authorized execution. Nothing
in the security patch automatically performs them.
