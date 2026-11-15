# Conditional configuration and observed history

[#1226](https://github.com/webnxt-2030/pinkraft/issues/1226) adds explicit conditional
mutation to the existing configuration lifecycle. Use `?version=2` on the owner
and partner configuration operations: current state, history, prepare, submit and
reconcile. Omit the selector or use `1` for retained v1 responses. Duplicate or
unknown selectors are refused. A selector must match the saved original intent
and permanent refusal generation; changing it never replaces a held original.

The supported layout, immutable owner-return destination and financial rules are
in [conditional v2](../conditional-v2.md). Network selection follows
[CLAUDE.md §7.5](../../CLAUDE.md#75-networks).

## Current terms and exact changes

`GET /api/v1/deployments/:id/configuration?version=2` returns the full verified
conditional state with `admin` and `mutationSupported:true`. The shared reader
verifies immutable construction semantics and salts, actual reviewed executable
hashes, initial/current getters, complete revisions and accounted obligations for
the prefix, condition and both branches within one bounded observation window.
Unsupported generations fail closed. A failed current read never falls back to
history. Credentials grant API access; only the immutable admin can authorize an
on-chain update.

Prepare requires a retained `Idempotency-Key` and a strict body:

```json
{
  "admin": "<immutable deployment owner wallet>",
  "arguments": {
    "version": 2,
    "changes": [
      {
        "kind": "condition",
        "nodeId": "condition",
        "expectedRevision": "0",
        "thresholdStroops": "101"
      }
    ]
  }
}
```

A threshold changes only when its original mode is explicitly mutable. Zero
through signed i128 max is supported; no-op, constant, overflow, duplicate or
unknown changes are refused. Pay/Split changes retain their declared eligibility,
row identities/order and allocation modes. Changes follow complete graph order;
Split row patches may use any unique row-ID order. The mutation binds every
artifact and revision including unchanged and inactive nodes. Any accepted
obligation anywhere blocks the whole group, including inactive accumulation and
debt with zero raw token balance. Raw balances or an inactive route do not erase
obligations. The grouped update moves no tokens and commits atomically.

The prepared receipt requires the original `intent`, `txHash`, `walletAddress`,
`xdr`, `expiresAt`, `network`, `networkPassphrase`, `feeStroops` and complete
`mutation` evidence. The admin is source, signer and fee payer. Simulation builds
the exact root/changed-child admin authorizations; immutable parent forwarding is
also enforced by the contracts. Review every branch, change, current revision,
network and fee before signing the same original envelope. Submit uses the existing
single sender, verifies the exact signature/body/auth/resources, and rechecks the
complete current graph and obligations before first send. Later races fail on chain.

## Original recovery and permanent refusal

The admission lock permits one unresolved configuration mutation. Duplicate keys
retain the exact request/admin/network/deployment digest and original envelope.
After lost responses, signing interruption or unknown finality, reconcile the
original intent/hash. An admitted send never becomes a new send because a current
getter failed or a threshold changed. Wall-clock expiry, missing storage rows and
RPC history gaps do not prove safe replacement. Authoritative expiry/non-inclusion
and existing retirement/access rules remain enforced.

Known pre-admission failures can return `error.fields.preparationRefusal` containing
one JSON string with a strict version2 `NOT_ADMITTED` proof. Its refusal ID,
deployment, network, admin, key hash and request digest must match the original.
The immutable fence prevents late admission for that key. An already admitted
matching original wins the race and must be recovered. Generic failures, revoked
admission and unresolved send outcomes provide no permanent refusal authority.
Never discard an original merely to try a new key.

## Observed history and events

`GET .../configuration/history?version=2` accepts `limit` and `cursor`, and returns
`version:2`, deployment/network, `coverage:"observed-revisions-only"`,
`historyComplete:false`, revision coverage, items and `nextCursor`. Each item has
its full versioned node state, observation ledger and nullable event provenance.
Live reads record all graph nodes, including immutable Receive/Return revision0
baselines. An observation is not evidence that a mutation event occurred.
Configuration hashes exclude ledger and obligation counters. Missing revisions
remain explicit counts; no state is synthesized to fill a gap.

Trusted `config_v2` events must match the immutable deployment's emitter, semantic
node, routing/constants and complete resulting state. Matching events can enrich a
previous getter observation with provenance; conflicting same-revision evidence
fails closed. Replays are idempotent, older valid revisions remain historical, and
projection failures retain raw events for retry before cursor progress. Initial
construction snapshots are never rewritten. Public configuration excludes private
contacts and draft metadata.

`route_v2` is routing/status evidence, not a configuration revision or proof of
recipient transfers. Its exact condition emitter, root, payer, nonce, amount and
full graph bindings are checked. It adds no configuration history row or payout
count. Historical selection is never recomputed using a newer threshold.

## SDK and compatibility

Use `deployment.configuration.conditional.get/history/prepare/submit/reconcile`.
Its separate strict types/parsers always select v2, retain exact originals and
validate structured receipt/admin/network/graph/changes and refusal evidence.
Existing generic signing helpers remain usable. SDK parsing does not independently
prove executable provenance or decode XDR; server verification and wallet review
remain required. Default v1 SDK methods, pending originals, artifact pins and
private templates retain their formats.

This is source implementation and local verification. It does not upload/activate
artifacts, deploy a service, publish an SDK or establish live wallet/network
acceptance. Conditional deployment/owner UI and hosted integration follow under
#1227/#1228; separate acceptance remains #1229. The older release gates remain open
where their actual evidence has not been collected.
