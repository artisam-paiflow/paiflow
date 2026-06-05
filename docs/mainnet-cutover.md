# Mainnet cutover

Pink Raft pins its Stellar network per environment via the `STELLAR_NETWORK`
env var. There is no per-deploy picker and no in-app mainnet kill switch. To
make a production environment actually deploy to Stellar mainnet, an operator
runs the steps below.

| Environment | `STELLAR_NETWORK` | Friendbot      | WASM hash vars                |
| ----------- | ----------------- | -------------- | ----------------------------- |
| Local dev   | `testnet`         | yes            | `STELLAR_WASM_HASH_*_TESTNET` |
| Staging     | `testnet`         | yes            | `STELLAR_WASM_HASH_*_TESTNET` |
| Production  | `mainnet`         | **no** (unset) | `STELLAR_WASM_HASH_*_MAINNET` |

## Prerequisites

- `UPLOADER_SECRET` — a Stellar mainnet secret key with enough XLM to pay
  upload fees for all three contracts (~5 XLM is plenty).
- A Railway service for production with `STELLAR_NETWORK=mainnet` set in its
  Variables page.
- The latest Rust toolchain + `stellar-cli` locally to build the WASMs.

## Step 1 — Build the contracts

```bash
pnpm contracts:build
pnpm contracts:optimize   # if present in the contracts workspace
```

Confirm the artifacts exist at:

```
contracts/target/wasm32v1-none/release/pinkraft_splitter.wasm
contracts/target/wasm32v1-none/release/pinkraft_streamer.wasm
contracts/target/wasm32v1-none/release/pinkraft_conditional.wasm
```

## Step 2 — Upload to mainnet

From a machine that can reach `https://mainnet.sorobanrpc.com`:

```bash
export UPLOADER_SECRET="S…your mainnet secret…"
pnpm contracts:upload --network=mainnet
```

The script appends three lines to `.env.local`:

```
STELLAR_WASM_HASH_SPLITTER_MAINNET=<hex>
STELLAR_WASM_HASH_STREAMER_MAINNET=<hex>
STELLAR_WASM_HASH_CONDITIONAL_MAINNET=<hex>
```

Capture those values — they go into Railway next.

## Step 3 — Configure Railway production

In the production service's **Variables**:

- `STELLAR_NETWORK=mainnet`
- `STELLAR_WASM_HASH_SPLITTER_MAINNET=<hex from step 2>`
- `STELLAR_WASM_HASH_STREAMER_MAINNET=<hex from step 2>`
- `STELLAR_WASM_HASH_CONDITIONAL_MAINNET=<hex from step 2>`
- Leave `STELLAR_FRIENDBOT_URL` **unset** (Friendbot does not run on mainnet).

Trigger a redeploy. The build step runs `prisma migrate deploy`; then start
the service, which will run `pnpm db:seed` only if you wire it in. If you
don't auto-seed:

```bash
# one-off, against prod
DATABASE_URL=… STELLAR_NETWORK=mainnet \
  STELLAR_WASM_HASH_SPLITTER_MAINNET=… \
  STELLAR_WASM_HASH_STREAMER_MAINNET=… \
  STELLAR_WASM_HASH_CONDITIONAL_MAINNET=… \
  pnpm db:seed
```

The seed upserts one `ContractTemplate` row per `(kind, mainnet)` tuple.

## Step 4 — Verify

- Visit `/flows/<id>/deploy` in production — the **Network: Mainnet** chip
  appears next to the Deploy button.
- Inspect `ContractTemplate` rows in the prod DB:

  ```sql
  SELECT kind, network, substring(wasm_hash for 12)
  FROM "ContractTemplate"
  WHERE network = 'mainnet';
  ```

  Three rows expected.

- Optional smoke: deploy a tiny Splitter from a low-value Stellar account.

## Rollback

There is no in-app kill switch. To halt mainnet writes in an emergency:

1. Scale the production Railway service to zero replicas, **or**
2. Re-set `STELLAR_NETWORK=testnet` on the prod service and redeploy. The app
   will then look up testnet `ContractTemplate` rows; if none exist for prod's
   DB, deploys will fail with a clear "no WASM uploaded" error.

Both are sledgehammers — prefer (1).

## Where the hashes live between runs

`.env.local` is gitignored and lives on the operator's machine. For team
durability, paste the hashes into the project's secret store (Railway
variables, 1Password, etc.) immediately after each upload. Do not commit the
hashes into the repo as plain env defaults — they need to match the WASM
artifacts in `contracts/target/`, which are reproducible from source but not
deterministic across toolchain versions.
