# Paiflow Soroban Contracts

Rust workspace for the pre-audited contract templates the Paiflow factory
instantiates per deployment. Members are grouped by block category —
`triggers/`, `conditions/`, `actions/` — plus the `factory/` itself. See
[`Cargo.toml`](./Cargo.toml) for the authoritative list.

```bash
rustup target add wasm32v1-none   # once
pnpm contracts:build              # from the repo root
```

Everything CI gates on, from this directory — run all three before opening a PR, since `clippy` is
`-D warnings` there and a warning fails the build:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
```

**The build, test, upload, and factory-deploy pipeline is documented in
[`../docs/soroban-smart-contracts.md`](../docs/soroban-smart-contracts.md)
§4.2–4.3.** Adding a new contract is §5 of the same document. Promoting new
WASM to mainnet is [`../docs/mainnet-cutover.md`](../docs/mainnet-cutover.md).
