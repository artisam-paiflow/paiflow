# Lantern unsigned scan fixtures

These five deterministic **offline** envelopes prepare the sample handoff requested
by [#1003](https://github.com/webnxt-2030/pinkraft/issues/1003). They exercise
Paiflow's current unsigned transaction builders. They have **not** been sent to
Lantern, simulated against a live network, signed, or submitted.

Use [manifest.json](manifest.json) for the base64 unsigned envelopes, decoded
arguments, source, target contract, method, amounts, fee, sequence, expiry and
TESTNET transaction hash. Every source/account byte, contract address, WASM hash
and salt is synthetic. The source public key is encoded directly from fixed bytes;
no private key or account keypair was created for this package.

| Fixture                   | Actual builder                   | Top-level contract call                                             |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| `splitter-distribute`     | `prepareDistributeInvocation`    | synthetic splitter `distribute(from, amount)`                       |
| `deposit`                 | `prepareDepositInvocation`       | synthetic deposit trigger `deposit(from, amount)`                   |
| `streamer-top-up`         | `prepareStreamerTopUpInvocation` | synthetic streamer `top_up(from, amount)`                           |
| `token-approve`           | `prepareTokenApproveInvocation`  | synthetic token `approve(from, spender, amount, expiration_ledger)` |
| `factory-deploy-pipeline` | `preparePipelineDeployTx`        | synthetic factory `deploy_pipeline(admin, blueprints)`              |

The invocation builders are in `lib/stellar/invoke.ts`; deployment is in
`lib/stellar/deploy.ts`. Deployment uses the real flow schema, graph-to-pipeline
conversion and constructor encoding for `on_receive → split`, with two fixed
recipients. Its outer operation is `invokeHostFunction` with
`hostFunctionTypeInvokeContract`. Creating child contracts happens inside the
factory call; this envelope is **not** a top-level `createContract` or WASM upload.
The decoded constructor blueprints include their salts and placeholder WASM hashes.

## Validation and regeneration

From the repository root, with locked dependencies installed and Prisma generated:

```sh
pnpm test tests/unit/stellar/lantern-scan-fixtures.test.ts
```

This reconstructs all five samples through the actual preparation builders with
mocked RPC responses and compares the entire package with the committed raw JSON
file snapshot. Separate decoder assertions check each committed envelope has no
transaction signatures, exactly one intended operation, only source-account
credentials, the correct top-level authorization invocation, exact arguments,
bounded expiry, and its expected TESTNET hash. Hashing the same envelope under
PUBLIC must produce a different transaction hash.

XDR does not contain its network passphrase. The explicit TESTNET manifest metadata,
known TESTNET hash and deterministic builder test establish the intended network;
the unsigned bytes alone do not establish it.

After reviewing an intentional builder or ABI change, regenerate the JSON with:

```sh
pnpm test tests/unit/stellar/lantern-scan-fixtures.test.ts --update
pnpm test tests/unit/stellar/lantern-scan-fixtures.test.ts
```

The second run is required: Vitest writes a refreshed file snapshot at the end of
the first run, while decoder tests read the currently committed file. Review the
manifest diff before committing it.

## Limits and live follow-up

Do not sign or submit these samples. Their fixed time bounds expired on
2026-01-01; sequence 42, ledger 1000, token-approval expiry 3111390, resources and
fees are synthetic. Mocked simulation contains only one target contract-instance
read/write footprint entry and one top-level source-account authorization. It
omits actual code/storage footprints, nested child/token authorization, real token
metadata, balances and deployment results. The graph's native asset is replaced
with a synthetic token contract. A scanner that resolves chain state should report
unknown contracts rather than infer deployed contracts or transferable value.

These artifacts support envelope parsing and method/argument display. They do not
prove Lantern risk classification, live simulation, support for Paiflow contracts,
mainnet readiness, or any desktop/Android wallet acceptance.

Before completing the #1003 handoff, capture fresh unsigned prepares from the
pinned Railway **testing** revision on Stellar **testnet**, record real contract
metadata and successful simulation provenance, independently verify that no
signature or scoped API intent is included, and send only after authorized. A
prepare can create server-side pending state, so live capture remains a separately
bounded testing action. This package performs no network calls or DB writes.
