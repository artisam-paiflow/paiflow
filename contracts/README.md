# Pink Raft Soroban Contracts

Three audited, parameterizable Soroban contracts. They are compiled once,
uploaded to the network, and instantiated per deployment with constructor
arguments derived from the visual builder.

## Build

```bash
rustup target add wasm32v1-none
cargo build --release --target wasm32v1-none
```

Optimized WASMs land at:

```
target/wasm32v1-none/release/pinkraft_splitter.wasm
target/wasm32v1-none/release/pinkraft_streamer.wasm
target/wasm32v1-none/release/pinkraft_conditional.wasm
```

## Upload

From the repo root:

```bash
pnpm contracts:upload
```

This reads the WASMs above and uploads them to the configured network,
writing the resulting hashes into `.env.local` so the seed script can
register them in `ContractTemplate`.

## Test

```bash
cargo test --workspace
```
