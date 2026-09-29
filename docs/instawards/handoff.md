# Evidence handoff

For the Ambassador Chapter Lead, Philippines chapter. This page is the evidence package for
Paiflow's Instawards Phase 1 sprint (7 September – 4 October 2026). It follows the checklist in
section 6.2 of the [Statement of Work](../instawards-phase-1-sow.md): one section per deliverable,
each listing the evidence that section 6.1 promised, with a link to each item.

**Everything below opens without an account.** Transactions open on
[stellar.expert](https://stellar.expert/explorer/testnet), code on the
[public repository](https://github.com/artisam-paiflow/paiflow), recordings on Google Drive, and
the app itself at [paiflow.xyz](https://paiflow.xyz) (click _Try the sandbox_ on the login page).
All of it runs on Stellar **testnet**; mainnet is out of scope for this Instaward.

| SOW §6.2 row  | What it is                                                                                        | Status                                                 | Detail page                              |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| Deliverable 1 | The swapper block executes a real swap through the Soroswap testnet router                        | Complete                                               | [D1](deliverables/d1.md)                 |
| Deliverable 2 | A developer API: deployment-scoped tokens, execute and events endpoints, OpenAPI and Postman      | Complete                                               | [D2](deliverables/d2.md)                 |
| Deliverable 3 | Shared builder input components, adopted in the Swapper config panel                              | Complete                                               | [D3](deliverables/d3.md)                 |
| Deliverable 4 | The validation package: demo video, usage guide, transaction list, end-to-end external-wallet run | In progress: the final CI report is added on 3 October | [Validation package](deliverables/d4.md) |

Each deliverable page has a traceability table: every clause of the SOW, the change that
implemented it, and the evidence that proves it. The rest of this page is the short version.

## Deliverable 1 — Real-DEX swapper

SOW §6.1: "Live app URL + screen recording + Stellar Expert tx hash + WASM hash".

| Evidence           | Link                                                                                                                                   | What to look for                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Live app URL       | [paiflow.xyz](https://paiflow.xyz)                                                                                                     | Open the builder; **Swap** is in the palette under Actions                                                                   |
| Screen recording   | [Google Drive](https://drive.google.com/file/d/1hcaNcojXrLmEYmTEHrNavQ_Wu9xgqaHL/view?usp=sharing) (11 Sep)                            | Build Receive XLM → Swap → Pay USDC, deploy with a browser wallet, trigger it, the recipient's USDC balance before and after |
| Swap tx hash       | [`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)             | The recorded run: 100 XLM → 10.5594796 USDC. The events list shows `SoroswapRouter / swap`                                   |
| Contract WASM hash | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) | The swapper binary on testnet; every deployed swapper's page shows the same hash                                             |

## Deliverable 2 — Developer API

SOW §6.1: "Public API URL + OpenAPI spec/Postman Collection + curl samples + audit log + tx hash".

| Evidence                 | Link                                                                                                                       | What to look for                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Public API URL           | [`paiflow.xyz/api/v1/openapi.json`](https://paiflow.xyz/api/v1/openapi.json)                                               | The live API describing itself; it answers with no token                                  |
| OpenAPI spec and Postman | [`openapi.json`](../api/openapi.json), [Postman collection](../api/paiflow-api-v1.postman_collection.json)                 | Importable; each request has example responses                                            |
| curl samples             | [Developer API guide](../api/README.md#quick-start), and the run's [curl transcript](evidence/d2/01-curl-transcript.md)    | Copyable commands for prepare → sign → submit → events                                    |
| Audit log entry          | [`06-audit-rows.json`](evidence/d2/06-audit-rows.json)                                                                     | The rows written for one API execution                                                    |
| API-triggered swap       | [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7) | 10 XLM swapped through the router, executed through `/api/v1` with a token and no browser |

To try it without an account, [Trying the API](../api/README.md#trying-the-api) hands out a
60-minute demo token in one command.

## Deliverable 3 — Shared builder inputs

SOW §6.1: "Live app URL + screen recording + before-and-after UI screenshots + CI test report".

| Evidence                     | Link                                                                                                                                                             | What to look for                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Live app URL                 | [paiflow.xyz](https://paiflow.xyz)                                                                                                                               | Add a Swap block and open its panel: the shared asset, amount and slippage inputs                 |
| Screen recording             | [Google Drive](https://drive.google.com/file/d/1bcZP0jpYhn_9kdQzs73kr01DpXBeXn2Y/view?usp=sharing) (25 Sep)                                                      | Building a swapper flow with the new inputs, their validation messages, keyboard use, and a phone |
| Before-and-after screenshots | [`17-swap-panel-before-after.png`](evidence/d3/17-swap-panel-before-after.png)                                                                                   | The panel before D3 beside the panel after it                                                     |
| CI test report               | [CI run 35982489259](https://github.com/artisam-paiflow/paiflow/actions/runs/35982489259), committed as [`21-vitest-junit.xml`](evidence/d3/21-vitest-junit.xml) | Component tests passing                                                                           |

## Deliverable 4 — Validation package

SOW §6.1: "Demo video (technical walkthrough). Usage guide. Tx hash list for all settlements on
Stellar Expert." Section 5.1's week 4 adds an end-to-end test with an external wallet and a final
CI pass.

| Evidence                               | Link                                                                                                                                                                          | What to look for                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo video (technical walkthrough)     | [Google Drive](https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing), 3:49                                                                      | How a drawn flow becomes contracts, a swap traced on chain, the builder's guard rails, and the API on the same deployment                                                     |
| Usage guide                            | [Integration guide](../guide/README.md)                                                                                                                                       | One flow from the builder to a backend, with the real transaction payloads decoded                                                                                            |
| Tx hash list for all settlements       | [Transaction list](evidence/transactions.md)                                                                                                                                  | Every swap the public app settled up to the 26 September snapshot, and the deployment behind each, linked to stellar.expert; regenerated from the final snapshot on 3 October |
| End-to-end run with an external wallet | [Recording](https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing) (9:44) and [its record](evidence/d4/README.md#the-freighter-run-28-september) | One unedited take: build, deploy and trigger signed in **Freighter**, then the same deployment run twice through the API                                                      |
| Scripted end-to-end run                | [D4 evidence pack](evidence/d4/README.md#the-scripted-run-28-september)                                                                                                       | The same three steps on one deployment, with every transaction envelope kept in full                                                                                          |
| Final CI and typecheck pass            | [Validation package](deliverables/d4.md#final-ci-and-typecheck-pass)                                                                                                          | The report on the final commit                                                                                                                                                |

## Contract addresses and WASM hash

The full list, with every deployed pipeline, is in the
[evidence index](evidence/README.md#contracts).

| Contract                  | Address or hash                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Swapper WASM hash         | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) |
| Paiflow factory           | [`CBFZTEZZ…ZJNK`](https://stellar.expert/explorer/testnet/contract/CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK)           |
| Soroswap router (testnet) | [`CCJUD55A…7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)           |
| Soroswap XLM/USDC pair    | [`CCBX3NZT…7RQS`](https://stellar.expert/explorer/testnet/contract/CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS)           |

## Success metrics

SOW §6.3. The figures come from the application's own database and from PostHog, and are reported
on three bases that are never added together; [metrics](metrics.md) explains each and how to
recompute it.

| Metric                                   | Target | Archive (to 16 Sep) | Live (since 15 Sep) | Alpha testers |
| ---------------------------------------- | ------ | ------------------- | ------------------- | ------------- |
| Unique flows deployed                    | ≥ 5    | 26 ✓                | 64 ✓                | 26 ✓          |
| Contract executions / events published   | ≥ 60   | 61 ✓                | 128 ✓               | —             |
| Unique swapper flows executed on testnet | ≥ 5    | 16 ✓                | 17 ✓                | 5 ✓           |
| Contract WASM uploaded                   | ≥ 1    | 1 ✓                 | 1 ✓                 | 1 ✓           |
| Public testnet URL live and accessible   | Yes    | Yes ✓               | Yes ✓               | Yes ✓         |
| Demo video published                     | Yes    | Yes ✓               | Yes ✓               | Yes ✓         |

The SOW's adoption target in §3.8 also asks for ≥ 6 distinct deploying wallets: 7 on the archive,
20 live, 7 among the alpha testers. The live and alpha figures are from 26 September.

## Checking it yourself

1. Open any transaction link above. On stellar.expert, the **events** list of a swap shows
   `SoroswapRouter / swap` emitted by `CCJUD55A…7BRD`, the router above.
2. Open [paiflow.xyz](https://paiflow.xyz), click _Try the sandbox_, and build Receive → Swap → Pay.
   Deploying needs a testnet wallet such as Freighter; building and the plain-English preview do not.
3. Run `curl -s https://paiflow.xyz/api/v1/openapi.json | head` to see the API answer.
4. Follow the [integration guide](../guide/README.md) for the full path, about fifteen minutes.

## Known limitations

These are open, tracked, and outside what the SOW asked for. None stops a deliverable from
working as described above.

- **The API relays an envelope its `from` account never signed** (#550). An unsigned or
  wrong-network envelope reaches the network and comes back `FAILED txBadAuth` instead of being
  refused up front. No funds can move without the depositor's signature either way.
- **A refused or failed API submit leaves no audit row** (#547); successful executions are audited.
- **The API's submit path lags the app's on two audit and error-reporting details** (#604): a
  resubmitted transaction can skip its audit row, and a send status the SDK does not recognise is
  reported as pending rather than as an error. Neither affects funds.
- **Not every write route is rate-limited** (#371). The API and sign-in are; 31 routes in the app
  that change data are not.
- **CI's dependency audit is advisory** (#523). `pnpm audit` runs in CI but does not fail the build
  while two advisories (one moderate, one low) in transitive dependencies are open.
- **Lower-severity findings** from the external QA run, the builder survey and a scale audit are
  kept as open issues rather than fixed inside the sprint.

Issue numbers are those of the private development repository, as explained on the
[home page](README.md#a-note-on-issue-numbers).

## Where everything is

- **Weekly reports:** [week 1](week-1.md), [week 2](week-2.md), [week 3](week-3.md),
  [week 4](week-4.md).
- **Evidence index:** [every contract, transaction, screenshot and recording](evidence/README.md).
- **Source:** [github.com/artisam-paiflow/paiflow](https://github.com/artisam-paiflow/paiflow); the
  changes that reached users are in its [promotion pull requests](https://github.com/artisam-paiflow/paiflow/pulls?q=is%3Apr+base%3Amain).
- **Statement of Work:** [as approved on 24 July 2026](../instawards-phase-1-sow.md).
