# D4 evidence pack

Week 4's validation package: the end-to-end run with an external wallet, the demo video, and the
records behind them. The three deliverables are run here, one after another, on **one** deployment
of the public app.

## The scripted run, 28 September

`tests/e2e/d4-end-to-end.spec.ts` against [paiflow.xyz](https://paiflow.xyz) at build `d850197`
(from `/api/health`, recorded in each file), from a registered account that is not in the alpha
cohort. A throwaway testnet key signs in place of the browser wallet, and every envelope is the one
the UI would hand to Freighter. The Freighter half is [the recorded run](#the-freighter-run-28-september) below.

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

## The Freighter run, 28 September

The human half of the external-wallet test: one unedited screen recording on
[paiflow.xyz](https://paiflow.xyz) at build `d850197`, following
[`e2e-run-checklist.md`](e2e-run-checklist.md).
**[Recording on Google Drive](https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing)**
(9:44, no narration). A registered account builds `on_receive XLM → swap → pay USDC`, deploys it
with **Freighter** and triggers it from Freighter, then mints a deployment token and runs the same
deployment twice through `/api/v1` from the Postman collection, signing each envelope locally with
the Stellar CLI.

| Step                                 | At   | Transaction                                                                                                                | Swap                    |
| ------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Deploy, signed in Freighter (D1)     | 2:40 | [`5bc90ab0…`](https://stellar.expert/explorer/testnet/tx/5bc90ab08ccf29ef827b59e5d8e24a28b649e12c67125c3858bb17f771cc5109) | —                       |
| Trigger, signed in Freighter (D1)    | 3:20 | [`00acc386…`](https://stellar.expert/explorer/testnet/tx/00acc3862b13337fcb9f2289a97c3fb07075ba7d7b4db82a0ea4d8ce01a6eed1) | 25 XLM → 2.6412762 USDC |
| Execute through `/api/v1` (D2)       | 5:40 | [`a759da4a…`](https://stellar.expert/explorer/testnet/tx/a759da4a6357a1ec0da071433a3588878ee995059b63ad7169bf87d9fdaa9e37) | 1 XLM → 0.1056503 USDC  |
| Execute through `/api/v1` again (D2) | 8:15 | [`cf1f70f5…`](https://stellar.expert/explorer/testnet/tx/cf1f70f552f23c35351d83a47133bcdefe209e1bd4df676032509456b92ed524) | 10 XLM → 1.0565005 USDC |

Deployment `964e252f`. Each swap went through the Soroswap router `CCJUD55A…7BRD`, and the trigger
transaction's invocation tree is opened on stellar.expert in the take at 4:10. The record, with
every segment's timestamp and the pipeline's contract addresses, is
[`04-e2e-wallet-run.json`](04-e2e-wallet-run.json); the raw `getTransaction` for all four is
[`04-e2e-wallet-run.getTransaction.json`](04-e2e-wallet-run.getTransaction.json). The take does not
open the deploy or the two API transactions on stellar.expert; they are linked above.

## The technical walkthrough video

SOW §5.1 week 4, "Record and publish 3–5 min technical demo video", and §6.3 "Demo video
published". **[paiflow-walkthrough on Google Drive](https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing)**,
3:49, 1920×1080, voice-over with burned-in captions, made from
[`walkthrough-script.md`](walkthrough-script.md). It explains how Paiflow works: the architecture,
what a swap does on chain (the scripted run's trigger, `750f64c1…`), building a flow with its guard
rails, the developer API on the same deployment, and where to check it all on GitBook. The closing
segment shows the evidence index where the script names the handoff page, which was not yet written
when the video was cut. sha256 `54a6ab68dd8b81d2653ffd2faaec842de625dacdb3b0475b5fbaee440c479ea4`.

## Files

| File                    | What it is                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `01-e2e-deploy.*`       | The flow graph, the prepared and signed deploy envelope, the pipeline's contract addresses, raw RPC |
| `02-e2e-trigger.*`      | The trigger envelope, unsigned and signed; the contracts that emitted events; raw RPC               |
| `03-e2e-api-execute.*`  | Prepare and submit responses, the signed envelope, both legs' swap events from `/events`; raw RPC   |
| `04-e2e-wallet-run.*`   | The Freighter run's record: recording, segments, deployment, the four transactions; raw RPC         |
| `e2e-run-checklist.md`  | The checklist for the end-to-end run with Freighter (the human half of the external-wallet test)    |
| `walkthrough-script.md` | The technical walkthrough video's script: segments, narration, on-screen actions                    |
