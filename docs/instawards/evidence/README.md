# Evidence index

Every artefact produced during the sprint, in one place. Transaction links open on
[stellar.expert](https://stellar.expert/explorer/testnet) and need no account.

**Testnet history is periodically reset.** Where a transaction has been captured, the raw
response is saved alongside it in this directory so the record survives even if the explorer
link stops resolving.

## Contracts

| Item                      | Value                                                                                                                                                             | Deliverable |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Swapper WASM hash         | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes, on testnet | D1          |
| Factory contract          | _pending — recorded from the public app at the deploy-and-trigger run_                                                                                            | D1          |
| Soroswap router (testnet) | [`CCJUD55A…7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)                                      | D1          |
| Soroswap XLM/USDC pair    | [`CCBX3NZT…7RQS`](https://stellar.expert/explorer/testnet/contract/CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS) — `token_0` is USDC                  | D1          |

The swapper WASM hash is the content hash of the uploaded binary, so it has no explorer page of
its own; the link above downloads the exact bytes from testnet, and the hash also appears on the
deployed swapper contract's own page once a swap flow is deployed. Reserves and a live quote can
be re-checked at any time with `pnpm soroswap:check`, which is the gate to run after a Soroswap
testnet reset.

## Transactions

| Date | What it proves | Deliverable | Transaction |
| ---- | -------------- | ----------- | ----------- |
|      |                |             |             |

## Screenshots and recordings

| Item                                               | Deliverable | File                          |
| -------------------------------------------------- | ----------- | ----------------------------- |
| Swapper config panel as it was before D1 (9 Sep)   | D3          | `d3/02-swap-panel-before.png` |
| Builder with the pre-D1 swap node selected (9 Sep) | D3          | `d3/01-builder-before.png`    |
| Palette before the Swap block was unhidden (9 Sep) | D3          | `d3/00-palette-before.png`    |

## API samples

| Item | Deliverable | File |
| ---- | ----------- | ---- |
|      |             |      |

## Scope

Only transactions produced from [paiflow.xyz](https://paiflow.xyz) during the sprint are
listed here, and only those count toward the [metrics](../metrics.md).
