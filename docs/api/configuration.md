# Guarded stored configuration API and SDK

[#1169](https://github.com/webnxt-2030/pinkraft/issues/1169) adds the API and SDK for
[guarded mutation v1](../mutation-v1.md). These routes do not activate artifacts,
deploy services or retrofit existing deployments. [Owner editing and signing review](../owner-configuration.md) implements #1170;
financial-safety release acceptance remains #1171. Phase release order is execution,
instances, mutation. Network selection follows [CLAUDE.md §7.5](../../CLAUDE.md#75-networks).

Only reviewed new-artifact Receive → Pay → … → terminal Pay/Split paths qualify.
The whole path uses one asset/admin and no delayed/prefunded/conditional obligation.
All fields retain their initial constant/execution/mutable modes. Updates cannot
change modes, routing, asset, admin, allocation kind, configured row identities or
ordering. Only declared mutable Pay/Split stored leaves may change. Split appended
rosters are complete replacements only when explicitly declared mutable.

## Routes and credentials

Each suffix below exists under both:

- `/api/v1/deployments/{id}/configuration`: scoped `pfk_` or selected-deployment
  `pfd_` bearer credentials; the permission matrix distinguishes read and operate.
- `/api/deployments/{id}/configuration`: authenticated owning developer session.
  Sandbox sessions and foreign owners cannot inspect or mutate the deployment.

| Method/suffix     | Request                                                                                   | Result                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`           | None                                                                                      | Verified current policies/configuration/revisions, full path, admin, ledger, accounted obligations                                                         |
| `GET /history`    | `?limit=20&cursor=<id>`, max 100                                                          | Retained confirmed observations, event receipts when available, revision coverage and next cursor                                                          |
| `POST /prepare`   | `{ admin, arguments: { version: 1, changes: [...] } }`; required `Idempotency-Key` header | Original intent/hash, exact simulated unsigned XDR, source/admin wallet, fee stroops, network/passphrase, 180-second expiry and complete reviewed mutation |
| `POST /submit`    | `{ intent, signedXdr }`                                                                   | Original hash and `SUCCESS`, `FAILED`, `PENDING`, `UNKNOWN` or `REJECTED`; HTTP success alone does not establish financial success                         |
| `POST /reconcile` | `{ intent }`                                                                              | Durable original reservation state and scoped transaction status; never signs or sends                                                                     |

All responses use `{ data: ... }` and `Cache-Control: no-store`. Writes are bounded
by the existing control preparation/submission/reconciliation limits and durable
service admission. New work requires CONFIRMED ACTIVE deployments on the environment
network. Owner and credential selections are rechecked before financial admission;
access removal preserves evidence. Sensitive prepare and submit audit evidence
records the owner, source, intent/hash and deployment; it never logs signed XDR.

A read-only developer credential can read state/history. Read-and-operate and
single-deployment legacy credentials can request the lifecycle routes for their
selected deployment. Template grants supply no deployment mutation scope. None of
these credentials authorizes an on-chain update. The deployment developer admin
is source, signer and fee payer, signing externally. This delivery supports
Ed25519 source-account admin wallets, not contract admins/address credentials or
delegated editors. Paiflow never receives the developer's private key.

## Exact preparation and recovery

A Pay change is `{ kind: "pay", nodeId, expectedRevision, recipient?, payoutValue? }`;
`payoutValue` is `{ kind: "fixed", amountStroops: "..." }` or
`{ kind: "percentage", bps: 1500 }`. Full Pay has no mutable payout value.
A Split change is `{ kind: "split", nodeId, expectedRevision, rows: [...] }`,
optionally with an explicit `additionalRecipients` array. Configured row patches
use `{ rowId, recipient?, allocation? }`; appended rows require all three fields.
The final group must satisfy allocation conservation, recipient uniqueness and
resource/recipient bounds. Empty/no-op/unknown/constant/execution overrides fail
before signing and on chain. Money and revisions are canonical bounded strings.

The server checks pinned actual WASM and complete `current_config` getters, then
`mutation_status` for every child, inside one whole-path instance-version read
window. Ordinary ledger advancement is allowed only when all instance values and
last-modified ledgers remain unchanged; configuration and obligations must describe
the same verified state. See [verified execution reads](../execution-v1.md#verified-execution-reads). Nonzero accounted obligations
anywhere in the path block every update, even when its raw token balance is zero.
Raw balance is not used as an admission shortcut. Full-path bindings and expected
revisions enter the root `mutate_v1` call. Simulation discovers every required
admin authorization; all must use the source-account signing protocol. Unexpected
address credentials fail closed. Contract-level checks protect the final read/send
race; old prepared payments fail on chain after a relevant revision changes.

Preparation persists exact unsigned envelope/hash, full path/arguments/artifacts,
original request digest, network, admin, ledger validity and hashed idempotency
key. The key is scoped to deployment/network and shared with other wallet controls;
reuse with different input/action fails 409. One unresolved mutation per deployment
serializes competing update preparations. Simulation failures reserve nothing.
Every changed final node increments once; initial snapshots are never rewritten.

Persist the original preparation/key before signing. Retries with the same key
and body return that original preparation, even if the chain subsequently changes.
Submission verifies the source signature on the configured network and every byte
of the prepared transaction body/auth/resource declarations, plus exact mutation
arguments. V0 and fee-bump envelopes are refused. Durable claim, signer/audit and
financial-work records commit before one sender broadcasts. Racing/duplicate
submissions never trigger a second send. Queue refusal and transport failure retain
the original intent. Another key cannot bypass uncertainty.

Reconcile the original hash/intent after a signing interruption, crash, refusal or
RPC timeout. Only actual ledger SUCCESS/FAILED or the shared authoritative closed-
ledger/full-history non-inclusion proof closes its reservation. Elapsed time,
NOT_FOUND alone, configuration changes, retirement or lost browser state do not
prove failure. There is no cancellation, deletion or blind replacement endpoint.
Retirement closes new service requests but retains controls/history/financial
work for existing authoritative retirement reconciliation. API access loss does
not erase obligations or evidence.

## Confirmed truth and historical gaps

Current reads always verify chain getters; history is never a fallback for a failed
current read. `ConfigurationHistory` stores each observed `(deployment, network,
node, revision)` separately with immutable terms/content hash and first observation
ledger. An identical observation may later gain its actual `config_v1` event ID,
transaction hash and `eventLedger`; a getter's observation ledger is not the update's
ledger. Conflicting same-revision evidence fails closed. Old events cannot replace
new current values. Directly submitted external admin updates follow the same
revision/event projection; no application signing record is fabricated for them.

Event ingestion retries projection before advancing its existing forward-only
cursor. It uses the actual emitter, pinned artifact, full path, immutable policies
and full event configuration. Getter observations and receipt projections remain
separate from original graph/parameter/pipeline snapshots. The API's `historyComplete`
is always false and `coverage` is `observed-revisions-only`: earlier revisions may
fall outside RPC retention or precede ingestion. `revisionCoverage` reports highest
observed revision, retained observation count and missing revision count per node.
A gap is retained as a gap; present values never reconstruct missing historical terms.

Existing execution/hosted previews already use verified current configuration and
revisions. Owner deployment detail exposes `currentConfiguration` separately from
`graphSnapshot`. The owner canvas displays a copied current graph, its confirmed
ledger, refreshes on activity/every 15 seconds and hides terms when current reads
fail; original snapshots remain available as initial evidence. The private [owner editor](../owner-configuration.md) now separates current values,
proposed terms, initial evidence and observed history. Supported mutable paths have no scheduled or relayer
payout worker; their event worker persists actual configuration receipts. Payment
notifications use actual payout event recipients and amounts. Constructor-time
recipient emails are not transferred to mutable/execution recipients, and owner
summaries never infer a payout from the initial roster.

## SDK

```ts
const configuration = client.deployment(deploymentId).configuration;
const state = await configuration.get();
const prepared = await configuration.prepare(
  {
    admin: developerAddress,
    arguments: {
      version: 1,
      changes: [
        {
          kind: "pay",
          nodeId: "pay",
          expectedRevision: "0",
          recipient: newRecipient,
        },
      ],
    },
  },
  { idempotencyKey: "durable-original-update-key" },
);
// Persist prepared/key before passing its exact XDR to external signing infrastructure.
const signed = await configuration.signPrepared(prepared, signer, {
  walletAddress: developerAddress,
  expectedNetwork: prepared.data.network,
});
const submitted = await configuration.submit(signed.submission, signed.submissionOptions);
// UNKNOWN/REJECTED: retain all original evidence and reconcile; do not prepare again.
const recovered = await configuration.reconcile({ intent: prepared.data.intent });
const history = await configuration.history({ limit: 20 });
```

The SDK validates typed requests, complete receipt identity, admin/network and
returned original arguments. It signs once through the caller callback and returns
explicit submit arguments without sending. It performs no automatic polling,
re-signing, rebroadcast or replacement. Keys travel in headers, credentials never
in URLs. No SDK package or API release is published by the implementation PR.
