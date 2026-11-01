# Exact parameterized execution

This API extends the existing `/api/v1/deployments/{id}/execute` lifecycle for new
policy-v1 deployments. It does not upgrade existing contracts. The shared policy,
units, stable Split rows, rounding and supported immediate path are defined in
[reusable flows](../reusable-flows.md). Artifact activation and funded acceptance
are separate from source delivery; missing or incompatible artifacts fail closed.

`GET /execution` returns either `supported:false` for a legacy definition, or the
verified artifact capabilities, current configuration/revisions and exact required
node-addressed inputs. The reader verifies actual deployed WASM against its pinned
deployment metadata and reviewed artifact manifest. Capabilities and current state
must be observed at one confirmed ledger; inconsistent or unavailable evidence is
an error. Configuration reads include on-chain wallet destinations but never private
notification emails or draft labels. Mutable configuration is not enabled here.

For a supported deployment, POST `/execute` with the ordinary `from` and `amount`
stroop string and an `arguments: {version:1, inputs:[...]}` object. A Pay input is
`{kind:"pay", nodeId:"pay", recipient:"G..."}`. Split inputs identify configured
rows by `rowId`; `additionalRecipients` contains the declared variable worker list.
Every declared input is required. Unknown inputs, constant overrides, wrong modes,
duplicate destinations and invalid final allocation totals fail before signing.
Fixed execution Splits consume exactly their incoming per-hop amount. Fixed Pay
underfunding fails; a terminal Pay refunds only that invocation's unspent remainder
to the original payer, never another balance.

Send a stable `Idempotency-Key` header for prepare retries (1–128 ASCII letters,
digits, `.`, `_`, `:`, `-`). Identical retries return the original preparation;
changed payloads return 409. Keys are deployment/network scoped and do not expire
automatically. Only key/request digests are stored. One unresolved payment per
payer/deployment prevents an accidental fresh payment after a lost response;
different payers have independent preparations. This is a general safety admission
rule, not a developer-configurable recipient/value limit.

Before returning an unsigned XDR, Paiflow persists its exact transaction hash,
unsigned envelope, payer, asset, amount, nonce, expiry, complete contract/revision
bindings and node inputs in the existing durable wallet-intent lifecycle. Retain
the returned `intent`, `txHash`, review data and history correlation before asking
the payer's wallet to sign the unchanged XDR with `networkPassphrase`. Paiflow never
receives private keys and does not persist wallet signatures or signed envelopes.

POST `/execute/submit` with `signedXdr` and the original `intent`. Signed-XDR-only
callers can also match the exact prepared hash. Operation/body/auth/resource/fee,
source, time bounds and inputs cannot change. The payer's actual source signature
must verify under the deployment network before attribution or relay. Tokens grant
API access; they never authorize spending. Submit rechecks live configuration before
its first send, and contracts reject stale revisions even if a mutation races that
check. Reconcile the obsolete preparation before preparing and signing new terms.

Only the replica that atomically claims the durable intent may send it. Concurrent
duplicates and retries after a crash/lost acknowledgement query the original hash;
they never rebroadcast automatically. `UNKNOWN`, queue `REJECTED`, missing RPC
history and elapsed wall-clock time are not proof that no payment occurred. POST
`/execute/reconcile` with `{intent}` or GET `/transactions/{txHash}` to recover
finality. Verified SUCCESS/FAILED receipts survive RPC history expiry. Reconciliation
can mark a preparation EXPIRED only after closing-ledger and complete history
coverage prove non-inclusion; uncertainty retains both the payer reservation and
deployment retirement blockers.

The existing legacy mode-less execute journey remains available without runtime
arguments or key-based preparation deduplication. It now also refuses unsigned,
wrong-key and wrong-network envelopes before relay (#550). Its historical submit
semantics do not gain the policy-v1 exact-intent guarantee. The broader legacy public
submission gap remains tracked in #851.

## Hosted integration handoff

Legacy public `/trigger`, `/submit-trigger` and `/submit-invoke` explicitly refuse
policy-v1 deployments before signer/audit/relay writes. The opt-in hosted execution
work (#1162) must reuse `prepareExecutionPayment`, `submitExecutionPayment` and the
wallet-intent reconciliation/status services through its own public routes. It must
check owner opt-in, bind the public request to its original payer/intent and expose
only safe receipt/status projections; knowing an intent never authorizes changes or
another payment. No fake API credential or Paiflow payer account is needed.

The shared submission service accepts public wallet attribution only for
`payment.execute`; existing wallet controls still require API credentials. Public
status/reconciliation routes must not serialize the private stored intent record or
accept caller-selected replacement hashes. Hosted visibility is a UI choice and
does not restrict direct contract calls. API deployments still require their
existing explicit token grants and operate permission; read-only credentials can
read configuration/status but cannot prepare, submit or reconcile.
