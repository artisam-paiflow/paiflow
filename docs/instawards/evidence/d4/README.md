# D4 evidence pack

Week 4's validation package: the end-to-end run with an external wallet, the demo video, and the
records behind them. The three deliverables are run here, one after another, on **one** deployment
of the public app.

## The scripted run, 28 September

`tests/e2e/d4-end-to-end.spec.ts` against [paiflow.xyz](https://paiflow.xyz) at build `d850197`
(from `/api/health`, recorded in each file), from a registered account that is not in the alpha
cohort. A throwaway testnet key signs in place of the browser wallet, and every envelope is the one
the UI would hand to Freighter. The Freighter half is the recorded demo.

| Step                                           | Transaction                                                                                                                | Files                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Deploy `on_receive XLM → swap → pay USDC` (D1) | [`28b9624e…`](https://stellar.expert/explorer/testnet/tx/28b9624e4b9225619ff21ec46558dd10048fba3409b98bc5896afecc63b4acda) | [`01-e2e-deploy.json`](01-e2e-deploy.json), [`.getTransaction`](01-e2e-deploy.getTransaction.json)                |
| Trigger from the app, 10 XLM (D1)              | [`750f64c1…`](https://stellar.expert/explorer/testnet/tx/750f64c1ac2e2e0085ffcc94aea1f15e2e3d5dcfc961625a92bb0cbf951db903) | [`02-e2e-trigger.json`](02-e2e-trigger.json), [`.getTransaction`](02-e2e-trigger.getTransaction.json)             |
| Execute through `/api/v1`, 10 XLM (D2)         | [`56929533…`](https://stellar.expert/explorer/testnet/tx/569295336b906aaeb9538c519bd4d5f7020671a945ac39908fe46d2651803ae6) | [`03-e2e-api-execute.json`](03-e2e-api-execute.json), [`.getTransaction`](03-e2e-api-execute.getTransaction.json) |

Deployment `516255e1`. Both swaps went through the Soroswap router `CCJUD55A…7BRD`, whose event is
in each transaction, and the recipient `GA2QEYNY…H3MR` received 2.1130664 USDC in all. The API leg
used a one-day deployment token (id and prefix recorded, the token itself never written), sent with
no session cookie, and revoked at the end of the run. Every envelope is kept in full, unsigned and
signed.

## Files

| File                    | What it is                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `01-e2e-deploy.*`       | The flow graph, the prepared and signed deploy envelope, the pipeline's contract addresses, raw RPC |
| `02-e2e-trigger.*`      | The trigger envelope, unsigned and signed; the contracts that emitted events; raw RPC               |
| `03-e2e-api-execute.*`  | Prepare and submit responses, the signed envelope, both legs' swap events from `/events`; raw RPC   |
| `e2e-run-checklist.md`  | The checklist for the end-to-end run with Freighter (the human half of the external-wallet test)    |
| `walkthrough-script.md` | The technical walkthrough video's script: segments, narration, on-screen actions                    |
