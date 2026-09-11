# Evidence index

Every artefact produced during the sprint, in one place. Transaction links open on
[stellar.expert](https://stellar.expert/explorer/testnet) and need no account.

**Testnet history is periodically reset.** Where a transaction has been captured, the raw
response is saved alongside it in this directory so the record survives even if the explorer
link stops resolving.

## Contracts

| Item                         | Value                                                                                                                                                                      | Deliverable |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Swapper WASM hash            | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes, on testnet          | D1          |
| Factory contract             | [`CBFZTEZZ…ZJNK`](https://stellar.expert/explorer/testnet/contract/CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK) — the public app's own factory                | D1          |
| Deposit trigger (9 Sep flow) | [`CC672N6Z…XYIH`](https://stellar.expert/explorer/testnet/contract/CC672N6Z77E4QEZ2JDEFLGNLVYUS5XS4J3WV7AUP5XVGU3JEVL2XXYIH) — receives the deposit that starts the flow   | D1          |
| Swapper (9 Sep flow)         | [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE) — runs the swapper WASM hash above            | D1          |
| Payer (9 Sep flow)           | [`CCI5K5UP…VZA5`](https://stellar.expert/explorer/testnet/contract/CCI5K5UPIXJWETFEFBUIMUG6ZKE5LXNUZCAVVBDFAHGE6VTKL5ARVZA5) — forwards the swap proceeds to the recipient | D1          |
| Soroswap router (testnet)    | [`CCJUD55A…7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)                                               | D1          |
| Soroswap XLM/USDC pair       | [`CCBX3NZT…7RQS`](https://stellar.expert/explorer/testnet/contract/CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS) — `token_0` is USDC                           | D1          |

The swapper WASM hash is the content hash of the uploaded binary, so it has no explorer page of
its own; the link above downloads the exact bytes from testnet, and the hash also appears on the
deployed swapper's own page, [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE). Reserves and a live quote can
be re-checked at any time with `pnpm soroswap:check`, which is the gate to run after a Soroswap
testnet reset.

## Transactions

| Date  | What it proves                                                                                        | Deliverable | Transaction                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| 9 Sep | A swapper flow deployed from paiflow.xyz, through the app's own factory in one `deploy_pipeline` call | D1          | [`775af303…`](https://stellar.expert/explorer/testnet/tx/775af303e24ebd7f59923544df3963cc17fa05e1db66174f38f4c3ae10670943) |
| 9 Sep | 50 XLM swapped to 5.2820859 USDC through the Soroswap router and paid on to the recipient             | D1          | [`3bded301…`](https://stellar.expert/explorer/testnet/tx/3bded301fff23b2f34d9ffcfefcb6528de7d594928cdc39a5d261c9dfbf8e927) |
| 9 Sep | 10 XLM swapped to 1.0564010 USDC through the Soroswap router and paid on to the recipient             | D1          | [`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b) |

The two swaps are the same deployed flow triggered twice. `d1/11-happy-path.json` records the
deployment, the three contracts the factory produced and the amounts in and out;
`d1/11-happy-path.getTransaction.json` is the raw RPC response for both, saved so the record
survives a testnet reset.

## How to verify the router

The Statement of Work asks for a swap executed through **the Soroswap router**. Two things have to
hold: that the transaction called that contract, and that the contract is Soroswap's rather than
one of ours. Each link is checkable without an account, and all four are recorded in
`d1/11-soroswap-router-proof.json`.

**The address is Soroswap's, by their own publication.** Soroswap lists its testnet deployment in
[`soroswap/core` → `public/testnet.contracts.json`](https://raw.githubusercontent.com/soroswap/core/main/public/testnet.contracts.json):
router `CCJUD55A…7BRD`, factory `CDP3HMUH…JTBY`. That is the address Paiflow pins as
`STELLAR_SOROSWAP_ROUTER_TESTNET` and injects at deploy time; it is never read from a flow graph,
so a flow cannot point itself at a different "router".

**The deployed code is Soroswap's, byte for byte.** The same file publishes a code hash per
contract. They match what is actually on testnet:

| Contract      | Published by Soroswap | Deployed on testnet |
| ------------- | --------------------- | ------------------- |
| Router        | `4b95bbf9…824c`       | `4b95bbf9…824c`     |
| Factory       | `86285a92…2993`       | `86285a92…2993`     |
| XLM/USDC pair | `8447525e…a464`       | `8447525e…a464`     |

**The transaction called it.** The diagnostic trace inside [`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b)
shows the Paiflow swapper `CC4AMKQP…ZJWE` invoking `swap_exact_tokens_for_tokens` on
`CCJUD55A…7BRD`, and the router in turn calling `get_reserves` and `swap` on the pair and
`transfer` on the XLM contract — 10 XLM in, 1.0564010 USDC out — before returning successfully.

**The events corroborate it.** The router emits `SoroswapRouter / swap` and the pair emits
`SoroswapPair / swap` and `sync`. Those symbols are compiled into Soroswap's binaries; Paiflow
cannot emit them. Every one is marked as part of a successful contract call, and the transaction
itself succeeded, so this is applied ledger state and not a simulation.

On the explorer, the quickest check is the transaction's event list: the `SoroswapRouter / swap`
entry names `CCJUD55A…7BRD` as the contract that emitted it, and that contract's own page shows
the code hash to compare against Soroswap's file.

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
