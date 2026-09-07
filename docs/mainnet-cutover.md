# Mainnet cutover

Paiflow pins its Stellar network per environment via the `STELLAR_NETWORK`
env var. There is no per-deploy picker and no in-app mainnet kill switch. To
make a production environment actually deploy to Stellar mainnet, an operator
runs the steps below.

| Environment | `STELLAR_NETWORK` | Friendbot      | WASM hash vars                |
| ----------- | ----------------- | -------------- | ----------------------------- |
| Local dev   | `testnet`         | yes            | `STELLAR_WASM_HASH_*_TESTNET` |
| Staging     | `testnet`         | yes            | `STELLAR_WASM_HASH_*_TESTNET` |
| Production  | `mainnet`         | **no** (unset) | `STELLAR_WASM_HASH_*_MAINNET` |

## How the app finds contracts

Read this before running anything — it explains why the cutover has four stages
rather than two.

At request time, `lib/stellar/config.ts` resolves every WASM hash and the
factory address **from the database first** (`ContractTemplate` and
`FactoryDeployment`), falling back to `STELLAR_WASM_HASH_*` /
`STELLAR_FACTORY_ADDRESS_*` env vars and logging a warning when it does. Either
route works. This runbook uses the database, because the sync script knows every
contract kind and a hand-maintained Railway variable list does not.

Uploading WASM does **not** by itself make a template visible in production: the
upload writes hashes to the operator's local `.env.local`, which is not the
production service's environment.

## Prerequisites

- **`UPLOADER_SECRET`** — a Stellar mainnet secret key, funded. It pays for
  every contract upload plus the factory deployment. For the actual cost rather
  than a guess, run `pnpm contracts:estimate` (below).
- **`STELLAR_RELAYER_SECRET_KEY`** — Paiflow's own mainnet key, funded. Without
  it every `cron/*` automation silently no-ops in production: payroll charges,
  subscription charges, streamer claims, timelock releases. Nothing errors; the
  work just never happens.
- A Railway service for production with `STELLAR_NETWORK=mainnet` in its
  Variables page.
- Rust — the toolchain CI pins, currently `1.95.0` (`.github/workflows/ci.yml`).
- For `pnpm contracts:estimate` only: `stellar-cli`, `wasm-opt`, `jq`, `curl`.
  The build and upload paths don't need them.

## The short version

```bash
export STELLAR_NETWORK=mainnet          # see the warning below
export UPLOADER_SECRET="S…mainnet…"
export DATABASE_URL="…production…"

pnpm contracts:deploy:mainnet
```

That chains build → upload → deploy-factory → update-hashes. The stages are
explained below; read them before running this against production, and note the
two environment variables it depends on that are easy to get wrong.

> **`STELLAR_NETWORK` must be `mainnet` in your shell.** The first three stages
> take `--network=mainnet` explicitly, but `scripts/update-hashes.ts` has no
> such flag — it reads `STELLAR_NETWORK` and defaults to `testnet`. On a machine
> whose `.env.local` says `testnet`, `pnpm contracts:deploy:mainnet` uploads to
> mainnet and then syncs **testnet** hashes into the database.

> **`DATABASE_URL` must point at production.** `deploy-factory` and
> `update-hashes` both write through the app's Prisma client. Run them with your
> local `DATABASE_URL` and you will configure your laptop's database instead.

## Step 1 — Build the contracts

```bash
pnpm contracts:build
```

This compiles every member of the workspace — see
[`contracts/Cargo.toml`](../contracts/Cargo.toml) for the list — and emits one
`.wasm` per crate into `contracts/target/wasm32v1-none/release/`.

To size up the mainnet bill before spending anything:

```bash
pnpm contracts:estimate
```

It optimizes each artifact with `wasm-opt -Oz` and quotes the upload cost
against mainnet RPC. It prompts for a seed and needs
`STELLAR_SOROBAN_RPC_URL_MAINNET` set.

## Step 2 — Upload to mainnet

From a machine that can reach `https://mainnet.sorobanrpc.com`:

```bash
export UPLOADER_SECRET="S…your mainnet secret…"
pnpm contracts:upload:mainnet
```

The script discovers artifacts automatically, maps each filename to a
`TemplateKind`, skips anything already uploaded with the same hash, and writes
one `STELLAR_WASM_HASH_<KIND>_MAINNET=<hex>` line per contract into
`.env.local`. `scripts/update-hashes.ts` holds the authoritative list of kinds.

Uploading is idempotent per network — identical bytes hash identically and the
network already holds the code.

## Step 3 — Deploy the factory

```bash
pnpm contracts:deploy-factory:mainnet
```

**Skipping this leaves production unable to deploy anything.** Flows are
deployed through an on-chain factory; with no factory address,
`preparePipelineDeployTx()` throws before it builds a transaction:

> Pipeline factory address is not configured. Run pnpm contracts:deploy-factory --network=&lt;network&gt;.

The script deploys `paiflow_factory.wasm`, writes the address to both the
database and `.env.local`, and records the factory's own WASM hash. It no-ops
when the built hash already matches `STELLAR_WASM_HASH_FACTORY_MAINNET`, so
re-running it after an unrelated contract change is safe.

## Step 4 — Sync hashes into the production database

```bash
STELLAR_NETWORK=mainnet DATABASE_URL="…production…" pnpm contracts:update-hashes
```

Reads the hashes and factory address out of `.env` / `.env.local` and upserts
`ContractTemplate` and `FactoryDeployment` rows for every kind it knows.

**Do not use `pnpm db:seed` for this.** It looks like it would work — it does
upsert `ContractTemplate` rows from the same env vars — but its template list
covers only 8 of the contract kinds, so the rest never appear. It also refuses
to run without `ADMIN_SEED_PASSWORD` (12+ characters) and creates admin users,
which is not something a hash sync should do to a production database.

## Step 5 — Configure Railway production

In the production service's **Variables**:

- `STELLAR_NETWORK=mainnet`
- `STELLAR_RELAYER_SECRET_KEY=<Paiflow's funded mainnet key>`
- `STELLAR_SOROSWAP_ROUTER_MAINNET=<Soroswap's mainnet router>` — required only if
  any flow uses a Swap block. Unlike the WASM hashes, this has no database
  fallback: `soroswapRouterAddress()` reads the environment alone, so deploying
  a swap flow without it fails with a plain-English error.
- Leave `STELLAR_FRIENDBOT_URL` **unset** (Friendbot does not run on mainnet).

The `STELLAR_WASM_HASH_*_MAINNET` and `STELLAR_FACTORY_ADDRESS_MAINNET`
variables are **not** required here — step 4 put them in the database, which is
what the app reads first. Set them only if you deliberately want the env
fallback; if you do, set the factory address too, and remember the list is one
variable per contract kind.

Trigger a redeploy. The build step runs `prisma migrate deploy`.

## Step 6 — Verify

- Visit `/flows/<id>/deploy` in production. The chip beside the Deploy button
  reads **MAINNET**, with `PINNED BY ENVIRONMENT` next to it.
- Check the template rows in the prod DB. The Prisma column is camel-cased, so
  it needs quoting:

  ```sql
  SELECT kind, network, substring("wasmHash" for 12)
  FROM "ContractTemplate"
  WHERE network = 'mainnet';
  ```

  Expect one row per kind in `scripts/update-hashes.ts` — 20 at the time of
  writing. Fewer means step 4 ran against the wrong database or with
  `STELLAR_NETWORK` unset.

- Confirm the factory landed:

  ```sql
  SELECT network, address FROM "FactoryDeployment" WHERE network = 'mainnet';
  ```

- Watch the logs for `env fallback` warnings on first deploy — they mean the app
  read a hash from an env var because the database row was missing.
- Optional smoke: deploy a minimal splitter flow from a low-value account.

## Rollback

There is no in-app kill switch. To halt mainnet writes in an emergency:

1. Scale the production Railway service to zero replicas, **or**
2. Re-set `STELLAR_NETWORK=testnet` on the prod service and redeploy. The app
   then resolves testnet templates. If prod's database has no testnet rows,
   deploys fail with "No WASM uploaded for &lt;kind&gt; on testnet"; if it does
   have them, deploys quietly succeed against testnet instead. Either way
   mainnet writes stop, which is the point.

Both are sledgehammers — prefer (1).

## Where the hashes live between runs

`.env.local` is gitignored and lives on the operator's machine; steps 2 and 3
write to it, and step 4 reads it. After a cutover the durable copy is in the
production database. Paste the hashes into the project's secret store (1Password
or similar) as well, so a second operator can re-run step 4 without repeating
the upload.

Do not commit hashes into the repo as plain env defaults — they must match the
WASM artifacts in `contracts/target/`, which are reproducible from source but
not deterministic across toolchain versions.
