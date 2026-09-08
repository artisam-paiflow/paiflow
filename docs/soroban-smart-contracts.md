# Soroban Smart Contracts on Stellar & How They Work in Paiflow

> **§1–§3 are about Soroban, §4–§6 are about Paiflow.** The first three sections describe the
> platform, not this repo, so they don't go stale as the code moves — keep them that way. The rest
> describes our pipeline, and holds only what the code can't state for itself: the crates,
> `contracts/Cargo.toml`, and `prisma/schema.prisma` are the authorities on what exists.

## 1. What Are Soroban Smart Contracts?

**Soroban** is the smart contracts platform integrated into the **Stellar blockchain**. It is not a separate chain — it lives alongside Stellar's existing operations (payments, trustlines, DEX).

Contracts are written in **Rust**, compiled to **WebAssembly (Wasm)**, and executed inside a sandboxed VM on Stellar validators. This provides deterministic, secure execution across all nodes.

### Key Properties

| Property               | Detail                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Language**           | Rust only (other languages may come later)                                                                       |
| **Compilation target** | `wasm32v1-none` (no_std, no OS dependencies)                                                                     |
| **Execution**          | Sandboxed Wasm VM, instantiated per invocation                                                                   |
| **Storage**            | On-chain ledger entries (temporary, persistent, instance)                                                        |
| **Fees**               | Per-instruction metering + rent for ledger space                                                                 |
| **Authorization**      | Built-in framework with account abstraction (Ed25519, secp256r1/passkeys, custom contract accounts)              |
| **Interoperability**   | Contracts can call other contracts; native Stellar assets are accessible via the built-in Stellar Asset Contract |

---

## 2. Core Concepts

### 2.1 Wasm Bytecode Lifecycle

```
[Write Rust] → [Compile to .wasm] → [Upload WASM to chain] → [Instantiate contract(s)]
```

- **Upload**: The `.wasm` binary is stored in a `CONTRACT_DATA` ledger entry, keyed by its SHA-256 hash (`WasmHash`).
- **Instantiate**: Creates a **contract instance** that references the uploaded Wasm. Each instance has its own storage and state. Multiple instances can share the same Wasm bytecode (one-to-many relationship).

### 2.2 Host & Guest Architecture

Soroban uses a **host/guest** model:

| Side                      | Role                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Host** (stellar-core)   | Provides ledger access, storage, crypto, event emission, cross-contract calls. Runs the Wasm VM.           |
| **Guest** (contract Wasm) | Sandboxed code. Only sees the host interface. Cannot access files, network, or memory outside its sandbox. |

The host exposes **host objects** (vectors, maps, addresses, big integers) and **host functions** (storage read/write, crypto, events, calling other contracts). The guest references host objects by integer **handles** — no serialization code needed in the contract.

### 2.3 Storage Types

| Storage        | Cost      | Lifetime                           | Use Case                                 |
| -------------- | --------- | ---------------------------------- | ---------------------------------------- |
| **Instance**   | Expensive | Tied to contract instance TTL      | Admin address, contract metadata, config |
| **Persistent** | Expensive | Independent TTL, can be restored   | User balances, long-term data            |
| **Temporary**  | Cheap     | Deleted at TTL, cannot be restored | Oracles, signatures, ephemeral data      |

All ledger entries have a **TTL (time-to-live)** and must be periodically "bumped" to stay alive. This is called **state archival**.

### 2.4 Authorization

Soroban has a flexible, layered authorization system:

1. **`Address.require_auth()`**: Called in contracts to demand that a specific `Address` authorized the current invocation.
2. **`Address` type**: Opaque identifier — can be a Stellar account (Ed25519), a contract account (custom logic), or the transaction invoker.
3. **Signature payloads**: The host constructs a structured payload (network ID + contract ID + function name + args), hashes it with SHA-256, and checks against the provided signatures.
4. **Replay protection**: Built-in nonce management — contracts don't need their own.
5. **Account abstraction**: Custom contract accounts can implement `__check_auth` to define any authentication logic (multisig, passkeys via secp256r1, hardware keys, etc.).
6. **Sub-contract auth pass-through**: If contract A calls `require_auth(user)` and then calls contract B which also calls `require_auth(user)`, the user only signs once.

### 2.5 Events

Contracts emit events via `env.events().publish((topic, ...), data)`. Events are:

- Published in transaction metadata (`TransactionMeta`)
- Queryable via RPC `getEvents` endpoint
- **Ephemeral**: RPC providers typically keep ~1 week of history
- Three types: `CONTRACT` (custom), `SYSTEM` (protocol-level), `DIAGNOSTIC` (debugging)

### 2.6 Contract Spec (ABI equivalent)

Every compiled Wasm contract contains embedded metadata sections:

- **`contractspecv0`**: Full typed interface — functions, structs, unions, errors (like Ethereum ABI but stronger typing, preserved comments, on-chain availability).
- **`contractenvmetav0`**: Environment interface version.
- **`contractmetav0`**: Optional metadata (name, version, author, repo URL).

This allows SDKs and tools to auto-generate typed clients (e.g., `SplitterClient`).

---

## 3. The Soroban Rust SDK

Every crate depends on `soroban-sdk` through the workspace, so the version is declared once in
`[workspace.dependencies]` in [`contracts/Cargo.toml`](../contracts/Cargo.toml) — read it there
rather than pinning a number here.

Key SDK constructs:

| Macro / Type                                  | Purpose                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `#[contract]`                                 | Marks a struct as a contract                                             |
| `#[contractimpl]`                             | Implements contract functions on the struct                              |
| `#[contracttype]`                             | Marks types for storage/events (serde)                                   |
| `#[contracterror]`                            | Defines typed error codes                                                |
| `Env`                                         | The guest's window into the host: storage, ledger, events, crypto, calls |
| `Address`                                     | Opaque account/contract identifier                                       |
| `token::Client` / `token::StellarAssetClient` | Typed clients for SEP-41 token contracts                                 |
| `symbol_short!("...")`                        | Compact symbols for event topics                                         |

A minimal contract:

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn hello(env: Env) -> &'static str {
        "hello, world"
    }
}
```

---

## 4. How Paiflow Implements Soroban Contracts

Paiflow uses a **pre-compiled WASM, deploy-through-a-factory** model. Contract logic is never
compiled per user; the WASM is built ahead of time and uploaded once per network, and a user's
"Deploy" instantiates a whole pipeline of those templates in a single transaction:

```
Build contracts (Rust) → Upload WASM once per network → Deploy the factory once per network
  → User hits "Deploy" → Backend pre-computes each child address and builds one
    deploy_pipeline tx → User signs → Backend submits
```

The factory (`contracts/factory/src/lib.rs`) is deliberately small and **kind-agnostic**: it takes a
`Vec<NodeBlueprint>` of `{ wasm_hash, salt, constructor_args }` and deploys each with
`env.deployer().with_address(source, salt)`, so child addresses are deterministic from
`source + salt` (CAP-46) and can be computed off-chain before the call. It knows nothing about node
types, which is why adding one never touches it. The wiring between nodes is TypeScript-side: each
child's address is computed first and passed to its neighbours as a constructor argument, so one
transaction lands a fully-connected pipeline.

### 4.1 The contract workspace

Twenty crates, grouped by block category — `contracts/triggers/`, `contracts/conditions/`,
`contracts/actions/`, plus `contracts/factory/`.
[`contracts/Cargo.toml`](../contracts/Cargo.toml) is the authoritative member list; the crates
themselves are the authority on storage, constructor arguments, and functions. Neither is restated
here, because a copy of either goes stale silently.

Two things are not obvious from reading one crate:

- **How a crate joins a pipeline.** The inbound edge is `execute_step(env, asset, amount)`, invoked
  by the upstream node — 11 crates implement it. The outbound edge is a stored
  `Vec<WorkflowTarget>` (`{ address, data }`), exposed by `next_steps()` on the 7 crates that
  forward, of which 4 also expose `set_next_steps()` for post-deploy rewiring. A crate with neither
  can only sit at the end of a pipeline.
- **`_dev` variants.** `splitter_dev`, `payer_dev`, `subscription_dev` and `cash_out_dev` are
  on-chain-mutable counterparts of their siblings, swapped in when a flow has `devMode` set so that
  values left blank at design time can be filled after deploy. See `CLAUDE.md` §2.

### 4.2 Contract build pipeline

Prerequisite (once per machine):

```bash
rustup target add wasm32v1-none
```

Then, from the repo root:

```bash
pnpm contracts:build   # cd contracts && cargo build --release --target wasm32v1-none
```

This compiles **every** member of the `contracts/` workspace — see
[`contracts/Cargo.toml`](../contracts/Cargo.toml) for the current list — and
emits one `.wasm` per crate into:

```
contracts/target/wasm32v1-none/release/
```

Artifact names are the crate name with `-` replaced by `_`, e.g.
`paiflow_splitter.wasm`, `paiflow_factory.wasm`, `payer.wasm`,
`cash_out.wasm`.

The size/safety `[profile.release]` — size-optimized, `overflow-checks = true` so integer overflow
traps rather than wraps, `panic = "abort"`, stripped, LTO — is declared **once** on the workspace in
[`contracts/Cargo.toml`](../contracts/Cargo.toml), not per crate. Don't add one to a crate.

Individual crates declare little more than `crate-type` and their `soroban-sdk` dependency.
`["cdylib"]` alone is enough for a contract that only has to compile to WASM; add `"rlib"` when
another crate needs to link it, which today is only for cross-contract tests (splitter's
dev-dependency on payer, for instance).

To run the contract test suites (each crate carries its own `#[test]` module
using `soroban-sdk`'s test env):

```bash
cd contracts
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

CI runs exactly these three commands in its `rust` lane, pinned to the Rust
toolchain in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### 4.3 WASM upload (bootstrap)

`scripts/upload-wasm.ts` uploads the built Wasm to a Stellar network. It needs
`UPLOADER_SECRET` — a funded Stellar secret key for that network — in the
environment.

```bash
pnpm contracts:upload            # uses STELLAR_NETWORK
pnpm contracts:upload:testnet    # --network=testnet
pnpm contracts:upload:mainnet    # --network=mainnet
```

Flow, per artifact:

1. Scan `contracts/target/wasm32v1-none/release/` for `*.wasm`.
2. Map the filename to a `TemplateKind`: strip a leading `paiflow_` /
   `pinkraft_` prefix and uppercase the rest. Files that don't map to a known
   kind are skipped with a warning — this is how the build stays permissive
   while the upload stays explicit.
3. SHA-256 the Wasm and skip the upload if that hash is already recorded for
   the network.
4. Build `Operation.uploadContractWasm({ wasm })`, simulate against Soroban
   RPC, assemble with the simulation result (sets resource fees), sign with the
   `UPLOADER_SECRET` keypair, submit, and wait for finality.
5. Write `STELLAR_WASM_HASH_{KIND}_{TESTNET|MAINNET}` into `.env.local`.

Uploading is **idempotent per network**: identical bytes produce the same hash,
and the network already holds the code.

The hashes in `.env.local` are not yet visible to the running app — the app
reads them from the `ContractTemplate` table. Two more steps close the loop:

```bash
pnpm contracts:deploy-factory   # deploys the factory, records its address
pnpm contracts:update-hashes    # copies hashes + factory address from .env* into the DB
```

Or all four at once:

```bash
pnpm contracts:deploy           # build → upload → deploy-factory → update-hashes
pnpm contracts:deploy:testnet
pnpm contracts:deploy:mainnet
```

**A fresh environment must end with a factory address.** Nothing can deploy without one: the app
resolves the factory through `getFactoryAddress()` in `lib/stellar/config.ts`, and
`deploy_pipeline` is the only path that instantiates a pipeline. `deploy-factory` skips only when
the built Wasm hash is unchanged **and** an address already exists — in
`STELLAR_FACTORY_ADDRESS_{TESTNET|MAINNET}` or as a `FactoryDeployment` row for the network — and it
logs which of the two it found. On a new machine or a rebuilt service neither exists and it
deploys. A testnet reset is different: it erases chain state but not `.env.local` and not the
`FactoryDeployment` row, so clear `STELLAR_FACTORY_ADDRESS_{TESTNET|MAINNET}` and delete the row for
the network before re-running, or the script will skip on a factory that no longer exists.

Verify before trusting the chain:

```bash
pnpm contracts:show-factory
```

A row for the network, with an address, is the proof. `update-hashes` logging
`STELLAR_FACTORY_ADDRESS_… not set, skipping` means the chain did not finish and the environment
cannot deploy yet.

See [`mainnet-cutover.md`](./mainnet-cutover.md) for the production runbook.

### 4.4 Deployment Flow (`lib/stellar/deploy.ts`)

When a user hits "Deploy" on a flow:

1. **`preparePipelineDeployTx()`** — Server-side:
   - `buildPipelinePlan()` draws a random 32-byte salt per node and derives each node's contract
     address with `computeContractAddress(sourceAccount, salt)` **before** anything is submitted.
     This is what makes wiring possible: a node's constructor can be handed the address of a sibling
     that does not exist yet.
   - Each node's constructor args come from `pipelineNodeConstructorArgs()` (§4.5), which receives
     the parent's address and the full `nodeId → address` map.
   - The nodes become one `Vec<NodeBlueprint>` passed to a single
     `Operation.invokeContractFunction` against the factory's `deploy_pipeline`.
   - Simulates to compute resource fees, then `rpc.assembleTransaction(tx, sim).build()`. A
     simulation error is mapped back through the address map to the node that rejected, so the user
     sees which block failed rather than a bare contract address.
   - Returns unsigned **XDR** plus the pre-computed pipeline (`nodeId`, `contractAddress`, `salt`,
     `templateKind`). `/api/deployments/prepare` stores that as `Deployment.pipelineSnapshot` — the
     durable `nodeId → contractAddress → templateKind` map everything downstream resolves through
     (`lib/flows/pipeline-snapshot.ts`), rather than re-deriving it from the graph.

2. **User signs** — Client-side via stellar-wallets-kit (Freighter, xBull, Albedo, etc.)

3. **`submitDeployTx()`** — Server-side:
   - Submits the signed XDR
   - Polls `getTransaction()` every 1.5s until `SUCCESS` or `FAILED`, giving up after 30s
   - Because the addresses were computed in step 1, nothing has to be read back out of the result to
     know what was deployed

`deployPipelineByRelayer()` runs the same plan signed by Paiflow's own relayer key instead of the
user, for flows the backend deploys on a user's behalf.

**Key security property**: The backend never sees or holds the user's secret key. It builds the transaction, the user signs, the backend submits.

### 4.5 Constructor Argument Encoding (`lib/stellar/scval.ts`)

Translates Paiflow's typed params into Soroban `xdr.ScVal[]`, using `nativeToScVal()` for `i128`,
`u32`, `u64`, `Address`, and vectors. Two entry points, one per deploy path:

| Function                                                               | Used by                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pipelineNodeConstructorArgs(params, admin, parentAddress, addresses)` | The factory path (§4.4). The trailing two arguments carry the wiring. |
| `constructorArgs(params, admin)`                                       | Single-contract deploys in `lib/stellar/dev-mutate.ts`.               |

`nodeBlueprint(wasmHash, salt, args)` wraps the result in the `NodeBlueprint` map the factory
expects. Each contract kind gets its own `case`; the switches are the reference for what a given
contract's constructor takes.

### 4.6 Event Polling (`lib/stellar/events.ts`)

A cron job calls `pollEventsFor(deploymentId)` every minute:

1. Resolves every contract in the deployment's `pipelineSnapshot`, not just the trigger address
2. Queries Soroban RPC `getEvents` with a cursor (last seen ledger)
3. Decodes `SCVal` topics and data — hand-rolled, since topic order is not guaranteed
4. Classifies each event into an `EventKind` (see `prisma/schema.prisma` for the current set)
5. Persists to the `ContractEvent` table in Postgres. Idempotency is the `eventId` unique
   constraint, not `(txHash, kind)`
6. Publishes to a Redis pub/sub channel for SSE streaming to clients

This gives users a real-time feed of their contract's activity.

### 4.7 Flow-to-Contract Mapping (`lib/flows/to-params.ts`)

`flowToPipeline(graph, relayer?, treasury?)` turns the builder's node graph into a
`PipelineNode[]` — one entry per contract to deploy, each with its `templateKind`, WASM hash and
constructor params. It is an array, not a single template: one flow generally deploys several
contracts. `CLAUDE.md` §2 traces the full graph → params → XDR → snapshot chain.

---

## 5. How to Add a New Contract to Paiflow

### Step 1: Write the Contract (Rust)

Create a new crate under the category folder it belongs to —
`contracts/triggers/`, `contracts/conditions/`, or `contracts/actions/`:

```
contracts/actions/escrow/
├── Cargo.toml
└── src/
    └── lib.rs
```

Example `Cargo.toml` — inherit everything you can from the workspace:

```toml
[package]
name = "paiflow-escrow"
version.workspace = true
edition.workspace = true
license.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
```

Register it in the workspace `contracts/Cargo.toml`, path-relative to
`contracts/`:

```toml
members = [
  # ...
  "actions/escrow",
]
```

The build artifact is the crate name with `-` replaced by `_` —
`paiflow_escrow.wasm`. Do not set `[profile.release]` here; the workspace
already declares it (§4.2).

### Step 2: Implement the Contract

Follow the existing patterns. Key conventions in this project:

- Use `#![no_std]`
- Define storage keys as a `Key` enum with `#[contracttype]`
- Define errors as an `Error` enum with `#[contracterror]`
- Name the constructor `__constructor` (Soroban convention for auto-invoked init)
- Use `instance()` storage for config that lives with the contract
- Call `require_auth()` on any `Address` that must authorize state changes
- Emit events via `env.events().publish()`
- Use `checked_add`/`checked_mul`/`checked_div` for all math
- Include unit tests with `#[cfg(test)]`

### Step 3: Register the Contract for Upload

`scripts/upload-wasm.ts` **discovers artifacts automatically** — there is no
list to edit. It scans the release directory, strips a leading `paiflow_`
prefix, uppercases the remainder, and looks the result up in `TemplateKind`.
So `paiflow_escrow.wasm` resolves to `TemplateKind.ESCROW` on its own, and an
artifact with no matching kind is skipped with a warning.

What you _do_ have to edit is `scripts/update-hashes.ts`, which copies hashes
from `.env*` into the `ContractTemplate` table from an explicit list:

```typescript
{ kind: TemplateKind.ESCROW, envKey: `STELLAR_WASM_HASH_ESCROW_${suffix}` },
```

Miss this and the upload will succeed while the app never sees the new
template.

### Step 4: Add a Prisma Template

Add an `ESCROW` value to the `TemplateKind` enum in `prisma/schema.prisma` and migrate.

Lean on the compiler for the rest: `TEMPLATE_LABELS` in `lib/flows/template-labels.ts` is an
exhaustive `Record<TemplateKind, string>`, so `pnpm typecheck` will name that site for you the
moment the enum grows.

### Step 5: Add Flow Schema & Params

1. Add new node types in `lib/flows/schema.ts` if the builder needs new UI blocks
2. Add a new `EscrowParams` type in `lib/flows/to-params.ts`
3. Emit it from `flowToPipeline()` (`lib/flows/to-params.ts`). Note the sibling `flowToParams()` is
   `@deprecated` — it predates the factory and returns a single `ContractParams` rather than a
   pipeline. Don't extend it.

### Step 6: Add Constructor Args Encoding

In `lib/stellar/scval.ts`, add a `case` to `pipelineNodeConstructorArgs()` — the factory path (§4.5).
Its `parentAddress` and `nodeAddresses` arguments are how a node receives the addresses of
neighbours that don't exist yet:

```typescript
case "escrow":
  return [
    addr(admin),
    addr(assetContractId(params.asset)),
    i128(params.amountStroops),
    addr(parentAddress),
    workflowTargets(params.nextStepNodeIds, nodeAddresses),
  ];
```

### Step 7: Add Builder UI (React)

- Add a new action/trigger node type in `components/builder/`
- Register it in `components/builder/palette.tsx`
- Wire up the config panel
- Add validation in `lib/flows/validate.ts`

### Step 8: The three easily-missed sites

Adding a kind touches more than the builder. None of these break the build if skipped, which is
exactly why they get skipped:

- **`lib/stellar/soroban-errors.ts`** — add the contract's error codes to `CONTRACT_ERRORS` and map
  the kind in `contractKeyForTemplate()`. Without it a failed simulation surfaces to the user as a
  raw numeric code instead of a message naming the block.
- **`lib/flows/template-labels.ts`** — the human-readable name (the compiler will insist, per
  Step 4).
- **`lib/stellar/balances.ts`** — if the contract holds funds the deployment view should show.

And in `lib/flows/english.ts` if the block should read as prose in the builder's preview pane.

### Step 9: Re-upload WASM

```bash
pnpm contracts:deploy:testnet
```

That runs build → upload → deploy-factory → update-hashes (§4.3). If the
factory itself is unchanged you can stop after the hashes:

```bash
pnpm contracts:build
pnpm contracts:upload:testnet
pnpm contracts:update-hashes
```

---

## 6. Architecture Decisions & Tradeoffs

### Why Pre-Compiled WASM?

| Approach                   | Pros                                                                          | Cons                                                  |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Pre-compiled** (current) | No Rust toolchain in deploy path, smaller audit surface, fast deploy (<1 min) | Cannot customize contract logic per deployment        |
| **Compile on deploy**      | Full customization                                                            | Slow, requires build servers, larger security surface |

Paiflow chooses pre-compiled because a library of parameterizable templates covers the target use
cases, and instant deploy + a fixed library of tested contracts is more important than arbitrary custom logic.
Composition is what buys back the expressiveness: a flow wires several templates into a pipeline
rather than asking for one bespoke contract.

### Why Client-Signed Transactions?

The backend **builds** the unsigned XDR. The user **signs** in their wallet. The backend **submits** the signed envelope.

This is non-custodial: the backend never touches private keys. It also means the user pays their own gas fees directly from their Stellar account.

### Why SSE Over WebSocket for Event Streaming?

SSE is simpler, works through most load balancers without sticky sessions, and auto-reconnects natively. The tradeoff is unidirectional (server→client only), but event streaming doesn't need bidirectionality.

### Why Polling Instead of Webhooks?

Soroban RPC does not provide a push/webhook mechanism for events (events are ephemeral, only kept ~1 week). Paiflow uses Railway cron jobs hitting `GET /api/cron/poll-events` every minute to poll `getEvents` with a cursor. This is simple and reliable, at the cost of up to 60s latency.

---

## 7. Useful References

| Resource                         | URL                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Stellar Smart Contracts Overview | https://developers.stellar.org/docs/build/smart-contracts/overview                        |
| Soroban Rust SDK Reference       | https://docs.rs/soroban-sdk/latest/soroban_sdk/                                           |
| Contract Storage Guide           | https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage       |
| Authorization Framework          | https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization |
| Events Guide                     | https://developers.stellar.org/docs/build/guides/events                                   |
| Getting Started Tutorial         | https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup           |
| Stellar CLI Reference            | https://developers.stellar.org/docs/tools/cli/stellar-cli                                 |
| Stellar Asset Contract (SEP-41)  | https://stellar.org/protocol/sep-41                                                       |
| Contract Spec (SEP-48)           | https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0048.md             |
| Stellar Lab Contract Explorer    | https://lab.stellar.org/smart-contracts/contract-explorer                                 |
