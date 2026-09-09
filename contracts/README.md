# Paiflow Soroban Contracts

Rust workspace for the unit-tested contract templates the Paiflow factory
instantiates per deployment. Members are grouped by block category —
`triggers/`, `conditions/`, `actions/` — plus the `factory/` itself. See
[`Cargo.toml`](./Cargo.toml) for the authoritative list.

> **No third-party security audit has been performed on these templates.** A formal audit is
> explicitly out of scope for the current sprint
> ([`docs/instawards-phase-1-sow.md`](../docs/instawards-phase-1-sow.md) §4.1). What they do carry
> is per-crate unit tests, team review, and the CI gates `cargo fmt --check`,
> `cargo clippy -D warnings` and `cargo test --workspace`. Do not describe them as audited.

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
