# Lantern Wallets Kit module provenance

`lantern.module.ts` is an **unchanged byte copy** of the import-free module at
[stellar-lantern commit 095d93f7247e530406a02d530c8f93dac5c1ea77](https://github.com/kimerran/stellar-lantern/blob/095d93f7247e530406a02d530c8f93dac5c1ea77/packages/lantern-wallets-kit-module/src/lantern.module.ts),
shipped with [v0.7.0-testnet.21](https://github.com/kimerran/stellar-lantern/releases/tag/v0.7.0-testnet.21).

SHA-256: `0b319c8dfea5f231d62eb62e93f1c4186b902a971b609c62b0ff69d1d7a473cb`.
The adjacent `LICENSE` is copied from that exact commit (MIT, Lantern contributors).
A narrow Prettier exclusion preserves the published checksum; local adaptation
belongs in `components/deploy/lantern-module.ts`, not in this file.

The wrapper targets Paiflow's existing Stellar Wallets Kit **1.9.5**, which ignores
upstream `onChange`. It deliberately owns a synchronous change subscription and
cleanup, validates desktop top-frame API v1/Testnet, uses the local icon and pinned
release URL, and checks transaction source, unchanged body, existing signatures
and the connected signer's new signature. No package upgrade is needed.
The upstream auth-entry/message methods are not exposed by our wrapper.

[API reference](https://golantern.xyz/docs/reference/connect/) and
[upstream usage](https://github.com/kimerran/stellar-lantern/blob/095d93f7247e530406a02d530c8f93dac5c1ea77/packages/lantern-wallets-kit-module/README.md)
were inspected on 2026-10-19. Source checks and mocked tests do not establish
real-extension or device acceptance. See [the integration guide](../../../../docs/lantern-wallet-provider.md).
