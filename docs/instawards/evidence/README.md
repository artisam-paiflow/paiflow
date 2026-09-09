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
| Factory contract          | [`CBFZTEZZ…ZJNK`](https://stellar.expert/explorer/testnet/contract/CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK) — the public app's own factory       | D1          |
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

All captured from [paiflow.xyz](https://paiflow.xyz) itself, not a development environment.

| Item                                                   | Deliverable | File                              |
| ------------------------------------------------------ | ----------- | --------------------------------- |
| Swap block on the canvas, palette and English preview  | D1          | `d1/01-builder-swap-flow.png`     |
| Swapper config panel: router, slippage, deadline       | D1          | `d1/02-swap-panel-after.png`      |
| Error: `assetIn` does not match the incoming asset     | D1          | `d1/03-error-asset-mismatch.png`  |
| Error: more than one outgoing edge                     | D1          | `d1/04-error-two-edges.png`       |
| Error: both sides of the swap are the same asset       | D1          | `d1/06-error-same-asset.png`      |
| Deploy review with the TESTNET chip and the live quote | D1          | `d1/07-deploy-review.png`         |
| Live Soroswap quote in the config panel                | D1          | `d1/08-swap-panel-live-quote.png` |
| Live quote on the builder canvas                       | D1          | `d1/09-builder-live-quote.png`    |
| Swapper config panel as it was **before** D1 (9 Sep)   | D3          | `d3/02-swap-panel-before.png`     |
| Builder with the pre-D1 swap node selected (9 Sep)     | D3          | `d3/01-builder-before.png`        |
| Palette before the Swap block was unhidden (9 Sep)     | D3          | `d3/00-palette-before.png`        |
| Screen recording of deploy and trigger                 | D1          | _added by the builder_            |

The D1 and D3 panel shots are the two halves of the same comparison. Before: `Asset In`,
`Asset Out` and a raw `Rate (basis points, 1–10000)`. After: the same two assets plus a
read-only `Soroswap (testnet)` router, `Max slippage (%)`, `Deadline (seconds)` and a live
quote reading `10 XLM → ~1.0564 USDC`.

## API samples

Request and response pairs recorded against the public app.

| Item                                                       | Deliverable | File                              |
| ---------------------------------------------------------- | ----------- | --------------------------------- |
| `slippageBps` outside 0–10000 rejected at the API boundary | D1          | `d1/05-error-slippage-range.json` |
| `deadlineSecs` below 1 rejected at the API boundary        | D1          | `d1/06-error-deadline.json`       |
| Live Soroswap quote endpoint response                      | D1          | `d1/10-quote-endpoint.json`       |

The quote sample is a real answer from the public app: 10 XLM quotes at `10564278` stroops of
USDC with a `10490132` minimum at 1 % slippage, through pair `CCBX3NZT…7RQS` on router
`CCJUD55A…7BRD`.

## Scope

Only transactions produced from [paiflow.xyz](https://paiflow.xyz) during the sprint are
listed here, and only those count toward the [metrics](../metrics.md).
