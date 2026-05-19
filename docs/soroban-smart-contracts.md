# Soroban Smart Contracts on Stellar & How They Work in Pink Raft

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

```toml
[dependencies]
soroban-sdk = "22.0.0"
```

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

## 4. How Pink Raft Implements Soroban Contracts

Pink Raft uses a **pre-compiled WASM, instantiate-on-deploy** model:

```
Build contracts (Rust) → Upload WASM once per network → User hits "Deploy" → Backend builds instantiation tx → User signs → Backend submits
```

### 4.1 The Three Contracts (`contracts/` workspace)

#### Splitter (`contracts/splitter/src/lib.rs`)

The "hero" contract — fans out incoming funds proportionally.

- **Storage**: `admin`, `asset`, `recipients: Vec<(Address, bps)>`, `paused`
- **Constructor params**: `admin`, `asset`, `recipients` (vector of `{ address, bps }` pairs that must sum to exactly 10,000 BPS)
- **Functions**:
  - `distribute(from, amount)` — Pulls `amount` from `from`'s wallet, splits it among recipients pro-rata. Rounding remainder goes to last recipient. Emits `distrib` and `payout` events.
  - `pause()` / `unpause()` — Admin-only toggle
  - `recipients()` — Read-only view of the recipient list

#### Streamer (`contracts/streamer/src/lib.rs`)

Time-based linear vesting / streaming.

- **Storage**: `admin`, `recipient`, `asset`, `rate_per_second`, `start_ts`, `end_ts`, `claimed`
- **Constructor params**: `admin`, `recipient`, `asset`, `rate_per_second`, `start_ts`, `end_ts`
- **Functions**:
  - `claim()` — Recipient-authorized. Computes vested amount by elapsed time × rate. Transfers the difference.
  - `top_up(from, amount)` — Anyone can fund the contract.
  - `cancel()` — Admin-authorized. Returns remaining balance to admin.

#### Conditional (`contracts/conditional/src/lib.rs`)

Release funds when a condition is met.

- **Storage**: `admin`, `recipient`, `asset`, `amount`, `condition` (JSON string), `released`
- **Constructor params**: `admin`, `recipient`, `asset`, `amount`, `condition`
- **Functions**:
  - `release()` — Admin-authorized in v1 (admin acts as off-chain validator). Transfers held `amount` to `recipient`.
  - `cancel()` — Admin-authorized. Returns remaining balance.
  - `status()` — Returns whether funds have been released.
- **Future**: Decode `condition` payload on-chain for timeout, oracle, or multisig enforcement.

### 4.2 Contract Build Pipeline

```
pnpm contracts:build
```

Compiles all three contracts to Wasm at:

- `contracts/target/wasm32v1-none/release/pinkraft_splitter.wasm`
- `contracts/target/wasm32v1-none/release/pinkraft_streamer.wasm`
- `contracts/target/wasm32v1-none/release/pinkraft_conditional.wasm`

Each contract's `Cargo.toml` uses the `soroban-sdk` crate and targets `wasm32v1-none`:

```toml
[lib]
crate-type = ["cdylib"]

[profile.release]
opt-level = "z"      # optimize for size
lto = true           # link-time optimization
panic = "abort"      # smaller binary
```

### 4.3 WASM Upload (Bootstrap)

`scripts/upload-wasm.ts` uploads each Wasm to the configured Stellar network:

```
tsx scripts/upload-wasm.ts
```

Flow:

1. Read `.wasm` file from disk
2. Build `Operation.uploadContractWasm({ wasm })`
3. Simulate the transaction (Soroban RPC)
4. Assemble with simulation results (sets resource fees)
5. Sign with `UPLOADER_SECRET` keypair
6. Submit and wait for finality
7. SHA-256 hash the Wasm → append to `.env.local` as `STELLAR_WASM_HASH_{KIND}`

This is a **one-time operation per network**. The resulting hashes are stored as env vars.

### 4.4 Deployment Flow (`lib/stellar/deploy.ts`)

When a user hits "Deploy" on a flow:

1. **`prepareDeployTx()`** — Server-side:
   - Creates `Operation.createCustomContract()` with the correct Wasm hash, a random 32-byte salt, and constructor arguments
   - Constructor args are built from the flow's visual blocks via `constructorArgs()` (`lib/stellar/scval.ts`)
   - Simulates the transaction to compute resource fees
   - Returns unsigned **XDR** + pre-computed **contract address** (deterministic from source account + salt)

2. **User signs** — Client-side via stellar-wallets-kit (Freighter, xBull, Albedo, etc.)

3. **`submitDeployTx()`** — Server-side:
   - Submits the signed XDR
   - Polls `getTransaction()` every 1.5s until `SUCCESS` or `FAILED`
   - Extracts the deployed contract address from the `returnValue`

**Key security property**: The backend never sees or holds the user's secret key. It builds the transaction, the user signs, the backend submits.

### 4.5 Constructor Argument Encoding (`lib/stellar/scval.ts`)

Translates Pink Raft's typed `ContractParams` into Soroban `xdr.ScVal[]`:

```typescript
function constructorArgs(params: ContractParams, admin: string): xdr.ScVal[] {
  switch (params.kind) {
    case "splitter":
      return [addr(admin), addr(assetContractId(params.asset)), recipientsVec];
    case "streamer":
      return [addr(admin), addr(params.recipient), addr(asset), i128(rate), u64(start), u64(end)];
    case "conditional":
      return [addr(admin), addr(params.recipient), addr(asset), i128(amount), cond];
  }
}
```

Uses `nativeToScVal()` for type-safe XDR encoding of `i128`, `u32`, `u64`, `Address`, and vectors.

### 4.6 Event Polling (`lib/stellar/events.ts`)

A cron job calls `pollEventsFor(deploymentId)` every minute:

1. Queries Soroban RPC `getEvents` with a cursor (last seen ledger)
2. Filters events for the deployment's contract address
3. Decodes `SCVal` topics and data via `scValToNative()`
4. Classifies events: `PAYOUT`, `RECEIVE`, `CLAIM`, `STATUS_CHANGE`
5. Persists to `ContractEvent` table in Postgres
6. Publishes to Redis pub/sub channel for SSE streaming to clients

This gives users a real-time feed of their contract's activity.

### 4.7 Flow-to-Contract Mapping (`lib/flows/to-params.ts`)

The visual builder's nodes map to contracts:

| Flow Template | Trigger       | Action                    | Contract        |
| ------------- | ------------- | ------------------------- | --------------- |
| Splitter      | `on_receive`  | `split`                   | **Splitter**    |
| Streamer      | `on_schedule` | `pay`                     | **Streamer**    |
| Conditional   | any           | `pay` + `condition` block | **Conditional** |

---

## 5. How to Add a New Contract to Pink Raft

### Step 1: Write the Contract (Rust)

Create a new directory under `contracts/`:

```
contracts/escrow/
├── Cargo.toml
└── src/
    └── lib.rs
```

Example `Cargo.toml`:

```toml
[package]
name = "pinkraft_escrow"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = { workspace = true }

[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
```

Register it in the workspace `contracts/Cargo.toml`:

```toml
members = ["splitter", "streamer", "conditional", "escrow"]
```

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

### Step 3: Add to the Upload Script

In `scripts/upload-wasm.ts`, add the new contract to the `CONTRACTS` array:

```typescript
{ kind: "ESCROW", wasm: "contracts/target/wasm32v1-none/release/pinkraft_escrow.wasm" }
```

### Step 4: Add a Prisma Template

Add a new `TemplateKind` enum value in `prisma/schema.prisma`:

```prisma
enum TemplateKind {
  SPLITTER
  STREAMER
  CONDITIONAL
  ESCROW
}
```

Update the seed script accordingly.

### Step 5: Add Flow Schema & Params

1. Add new node types in `lib/flows/schema.ts` if the builder needs new UI blocks
2. Add a new `EscrowParams` type in `lib/flows/to-params.ts`
3. Extend the `flowToParams()` function to handle the new template kind

### Step 6: Add Constructor Args Encoding

In `lib/stellar/scval.ts`, add a case for the new contract:

```typescript
case "escrow":
  return [
    addr(admin),
    addr(params.recipient),
    addr(assetContractId(params.asset)),
    i128(params.amountStroops),
    // ... additional args
  ];
```

### Step 7: Add Builder UI (React)

- Add a new action/trigger node type in `components/builder/`
- Register it in the palette
- Wire up the config panel
- Add validation in `lib/flows/validate.ts`

### Step 8: Re-upload WASM

```bash
pnpm contracts:build
tsx scripts/upload-wasm.ts
```

---

## 6. Architecture Decisions & Tradeoffs

### Why Pre-Compiled WASM?

| Approach                   | Pros                                                                          | Cons                                                  |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Pre-compiled** (current) | No Rust toolchain in deploy path, smaller audit surface, fast deploy (<1 min) | Cannot customize contract logic per deployment        |
| **Compile on deploy**      | Full customization                                                            | Slow, requires build servers, larger security surface |

Pink Raft chooses pre-compiled because the 3 templates cover the target use cases, and instant deploy + pre-audited contracts is more important than arbitrary custom logic.

### Why Client-Signed Transactions?

The backend **builds** the unsigned XDR. The user **signs** in their wallet. The backend **submits** the signed envelope.

This is non-custodial: the backend never touches private keys. It also means the user pays their own gas fees directly from their Stellar account.

### Why SSE Over WebSocket for Event Streaming?

SSE is simpler, works through most load balancers without sticky sessions, and auto-reconnects natively. The tradeoff is unidirectional (server→client only), but event streaming doesn't need bidirectionality.

### Why Polling Instead of Webhooks?

Soroban RPC does not provide a push/webhook mechanism for events (events are ephemeral, only kept ~1 week). Pink Raft uses Railway cron jobs hitting `GET /api/cron/poll-events` every minute to poll `getEvents` with a cursor. This is simple and reliable, at the cost of up to 60s latency.

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
