# Evidence index

Every artefact produced during the sprint, in one place. Transaction links open on
[stellar.expert](https://stellar.expert/explorer/testnet) and need no account.

**Testnet history is periodically reset.** Where a transaction has been captured, the raw
response is saved alongside it in this directory so the record survives even if the explorer
link stops resolving.

## Contracts

| Item                                   | Value                                                                                                                                                                      | Deliverable |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Swapper WASM hash                      | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes, on testnet          | D1          |
| Factory contract                       | [`CBFZTEZZ…ZJNK`](https://stellar.expert/explorer/testnet/contract/CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK) — the public app's own factory                | D1          |
| Deposit trigger (9 Sep flow)           | [`CC672N6Z…XYIH`](https://stellar.expert/explorer/testnet/contract/CC672N6Z77E4QEZ2JDEFLGNLVYUS5XS4J3WV7AUP5XVGU3JEVL2XXYIH) — receives the deposit that starts the flow   | D1          |
| Swapper (9 Sep flow)                   | [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE) — runs the swapper WASM hash above            | D1          |
| Payer (9 Sep flow)                     | [`CCI5K5UP…VZA5`](https://stellar.expert/explorer/testnet/contract/CCI5K5UPIXJWETFEFBUIMUG6ZKE5LXNUZCAVVBDFAHGE6VTKL5ARVZA5) — forwards the swap proceeds to the recipient | D1          |
| Deposit trigger (recorded 11 Sep flow) | [`CBJE3DVI…Q3IM`](https://stellar.expert/explorer/testnet/contract/CBJE3DVI3753PUZEUGFJWX4AAXUCULU427OMMAQVERB3A7JJRNJRQ3IM)                                               | D1          |
| Swapper (recorded 11 Sep flow)         | [`CBZ53HMV…QA3V`](https://stellar.expert/explorer/testnet/contract/CBZ53HMVYRCJDDTVOJ73SJ6KFXPUGDWU6TPZM4JJYEYIOC5DRRK5QA3V) — same WASM hash                              | D1          |
| Payer (recorded 11 Sep flow)           | [`CC2XTEP2…4ILJ`](https://stellar.expert/explorer/testnet/contract/CC2XTEP2Z2CQS2WCCLLQJSDYZKZX72PWFE7ZOJO37UKHYXIQ3OKE4ILJ)                                               | D1          |
| Soroswap router (testnet)              | [`CCJUD55A…7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD)                                               | D1          |
| Soroswap XLM/USDC pair                 | [`CCBX3NZT…7RQS`](https://stellar.expert/explorer/testnet/contract/CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS) — `token_0` is USDC                           | D1          |
| Deposit trigger (18 Sep D2 flow)       | [`CCO4SUZW…7HT5`](https://stellar.expert/explorer/testnet/contract/CCO4SUZWNBHIPCADMBCLWO4YOSLWFUDDUUMBYCQF6HRHIX3FBHDI7HT5) — receives the deposit the API prepares       | D2          |
| Swapper (18 Sep D2 flow)               | [`CD767KMX…YK46`](https://stellar.expert/explorer/testnet/contract/CD767KMX45WW43PTNBHP2D2MHR4633XVBY53UKIVX5LPZYRTED6RYK46) — same WASM hash as the D1 flows              | D2          |
| Payer (18 Sep D2 flow)                 | [`CDGWKFVY…WRIX`](https://stellar.expert/explorer/testnet/contract/CDGWKFVYWL5Z6QB7KIOBHJLAEK4DGDV7WG4IRMPXWYKCCG76466UWRIX) — forwards the swap proceeds to the recipient | D2          |

The swapper WASM hash is the content hash of the uploaded binary, so it has no explorer page of
its own; the link above downloads the exact bytes from testnet, and the hash also appears on every
deployed swapper's own page, for example [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE). Reserves and a live quote can
be re-checked at any time with `pnpm soroswap:check`, which is the gate to run after a Soroswap
testnet reset.

The code entry holding those bytes has its own time-to-live, separate from the instance storage a
contract extends when it runs. It was extended on 12 September to ledger 7742749, roughly 11 March
2027, in [`dd94ca8c…`](https://stellar.expert/explorer/testnet/tx/dd94ca8c6ce4c3606448706afbab902ac7ef1e781434a56fab292eb191975302).
The other nineteen binaries the public app instantiates were extended to the same horizon on the
same day. Most of them renew themselves in normal use — twelve of the twenty contracts call
`extend_ttl` when invoked, which covers the code entry as well as the instance — so the extension
is a precaution for all but two cases: the eight contracts with no such call (the factory, payroll,
yield, multisig, oracle, subscription and its dev variant, and webhook), and templates nobody has
deployed recently, which are never invoked and so never renew. The factory's own instance entry,
which every deploy invokes, was extended on 13 September to ledger 7756749 in
[`9302db7d…`](https://stellar.expert/explorer/testnet/tx/9302db7d72ecaa9f61ba26de36095a098fc363f288cdc155bc8f10e9fa012005). `pnpm contracts:extend-ttl` reports the current figure for any entry and
extends it again.

## Transactions

| Date   | What it proves                                                                                                                           | Deliverable | Transaction                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9 Sep  | A swapper flow deployed from paiflow.xyz, through the app's own factory in one `deploy_pipeline` call                                    | D1          | [`775af303…`](https://stellar.expert/explorer/testnet/tx/775af303e24ebd7f59923544df3963cc17fa05e1db66174f38f4c3ae10670943)                                                                                                                               |
| 9 Sep  | 50 XLM swapped to 5.2820859 USDC through the Soroswap router and paid on to the recipient                                                | D1          | [`3bded301…`](https://stellar.expert/explorer/testnet/tx/3bded301fff23b2f34d9ffcfefcb6528de7d594928cdc39a5d261c9dfbf8e927)                                                                                                                               |
| 9 Sep  | 10 XLM swapped to 1.0564010 USDC through the Soroswap router and paid on to the recipient                                                | D1          | [`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b)                                                                                                                               |
| 11 Sep | The recorded run: a sandbox session's swap flow deployed from the builder with a browser wallet                                          | D1          | [`c0460040…`](https://stellar.expert/explorer/testnet/tx/c04600408d910f55639a09b54725f65b38881820bbd468358be6546ce3416f18)                                                                                                                               |
| 11 Sep | The recorded run: 100 XLM swapped to 10.5594796 USDC through the Soroswap router and paid on to the recipient                            | D1          | [`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)                                                                                                                               |
| 15 Sep | Executed through the developer API (`/api/v1`, partner-signed): 10 XLM swapped to 1.0547687 USDC through the Soroswap router and paid on | D2          | [`5b1e738f…`](https://stellar.expert/explorer/testnet/tx/5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be)                                                                                                                               |
| 17 Sep | Internal testing of the developer API: two more swapper flows executed through `/api/v1`                                                 | D2          | [`8d8e1d6b…`](https://stellar.expert/explorer/testnet/tx/8d8e1d6b96c615b4ed6f6e8ce40218e07b8b0a38b5694b0fbf31675c7995e2f6)<br>[`cbe539ff…`](https://stellar.expert/explorer/testnet/tx/cbe539ffdfa204ec6b1463bfd1741f9cb2be1caa10e196096e52726faf97a577) |
| 18 Sep | The D2 evidence run, executed through the developer API (`/api/v1`, partner-signed): 10 XLM swapped to 1.0584167 USDC and paid on        | D2          | [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7)                                                                                                                               |
| 18 Sep | The same API driven from the Postman collection rather than curl: 1 XLM swapped to 0.1055731 USDC and paid on                            | D2          | [`27f68188…`](https://stellar.expert/explorer/testnet/tx/27f681889bfebdab92a4d9e6d70770ea5df72bd597c627bc5c0014d0d86bfbfb)                                                                                                                               |
| 25 Sep | The D3 recorded run: a registered user's swap-and-split flow deployed from the builder with Freighter                                    | D3          | [`f82d7486…`](https://stellar.expert/explorer/testnet/tx/f82d74863e90e36184bd7809b525fbf7f923843963b3c3178f94a1b576b33d63)                                                                                                                               |
| 25 Sep | The D3 recorded run: 50 XLM swapped to 5.2731437 USDC through the Soroswap router and split 60/40                                        | D3          | [`34048835…`](https://stellar.expert/explorer/testnet/tx/34048835187d7d4c66d496e35bbb4994caee88a82b362131ac5b260d52baeb31)                                                                                                                               |

The two 9 September swaps are the same deployed flow triggered twice. [`d1/11-happy-path.json`](d1/11-happy-path.json)
records the deployment, the three contracts the factory produced and the amounts in and out;
[`d1/11-happy-path.getTransaction.json`](d1/11-happy-path.getTransaction.json) is the raw RPC response for both, saved so the record
survives a testnet reset. [`d1/13-recording-run.json`](d1/13-recording-run.json) and
[`d1/13-recording-run.getTransaction.json`](d1/13-recording-run.getTransaction.json) are the same pair for the recorded 11 September run.
The 15 September API swap reuses the first 9 September flow, so it adds a swap transaction but not a new
flow. The 18 September run is D2's evidence swap, on a flow deployed for it; its prepare, submit,
`getTransaction`, events and audit records and the curl transcript are in [`d2/`](d2/README.md).
The second 18 September row is the Postman collection being exercised against the public app: it
runs the same four calls, so importing the collection and driving it produced a real swap rather
than only a passing request. Both 18 September swaps are on the same deployed flow, so they add
swap transactions but not new flows.

The 17 September pair are internal testing rather than evidence — the same API path, on two other
deployments — and are listed here so the record of what ran on the public app is complete. They are
not alpha-round activity and are counted on neither reporting basis.

## Swapper flows executed on testnet

Every deployment from paiflow.xyz whose swapper emitted a `swap` event through the Soroswap
router, from the application's own event records (snapshot of 12 September, details in
[`d1/14-swapper-flows.json`](d1/14-swapper-flows.json)). This is the source of the "unique swapper flows executed" metric.
"judge" and "sandbox" are the QA account and the no-account sandbox sessions.

| #   | Date   | Session                    | Deployment | Swapper contract                                                                                                             | Swap transactions                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------ | -------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 09 Sep | admin                      | `0786fca6` | [`CC4AMKQP…ZJWE`](https://stellar.expert/explorer/testnet/contract/CC4AMKQP3JMTUAWP3734PB4BZVWCYC6AYVJLWXQLFSLHK7ACB5UHZJWE) | [`3bded301…`](https://stellar.expert/explorer/testnet/tx/3bded301fff23b2f34d9ffcfefcb6528de7d594928cdc39a5d261c9dfbf8e927) (50 XLM → 5.2820859 USDC)<br>[`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b) (10 XLM → 1.0564010 USDC)<br>[`5b1e738f…`](https://stellar.expert/explorer/testnet/tx/5b1e738fab8b00279e19792d61e8a80eead9b53a4fab021a41ad2088265cb4be) (10 XLM → 1.0547687 USDC, via `/api/v1`, 15 Sep) |
| 2   | 10 Sep | judge                      | `44c3ed53` | [`CBWGUCYL…LI7M`](https://stellar.expert/explorer/testnet/contract/CBWGUCYLFBALLEC6GPSJBPSRYVLLBHCC7DEQJIB2T2TG4INW4AQ5LI7M) | [`8d870722…`](https://stellar.expert/explorer/testnet/tx/8d8707228a6b1d30b01dd2f5c6d956961f090cd9cd690c73d994f7a8a4ec8f3f) (10 XLM → 1.0563957 USDC)                                                                                                                                                                                                                                                                                                                                        |
| 3   | 10 Sep | judge                      | `8d184c20` | [`CCYBEFR2…YQKX`](https://stellar.expert/explorer/testnet/contract/CCYBEFR2SLHQJPQI7XUCRT5LERFAXW6WQYAGJK72IZTDIFLCWL7SYQKX) | [`9f7fa585…`](https://stellar.expert/explorer/testnet/tx/9f7fa585eac0f8b11cf3dee864438d6c078b1673d52c2c7584b56746e7a4aa4b) (100 XLM → 10.5636628 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 4   | 10 Sep | sandbox                    | `b13a9535` | [`CAOURKT5…7LOJ`](https://stellar.expert/explorer/testnet/contract/CAOURKT5YX24LS7TSEIFBDG5IYPAMGZA5HTLYZ5LWW73MIGO7M577LOJ) | [`baed3c00…`](https://stellar.expert/explorer/testnet/tx/baed3c00d905467baa369d0d14573226ce587b21b030ddad028f05f3837bcba6) (10 XLM → 1.0562831 USDC)                                                                                                                                                                                                                                                                                                                                        |
| 5   | 11 Sep | sandbox                    | `a89b6e6d` | [`CAYBCCAQ…7SKO`](https://stellar.expert/explorer/testnet/contract/CAYBCCAQ72CFJH6U3ZYZNNRGLEMSH4LAVZBRXMN5FLKXZWPIE5RZ7SKO) | [`4e717097…`](https://stellar.expert/explorer/testnet/tx/4e71709730f3e5f29737c77b1ce4db1a270f2997537d2fc094ca73b23a20614f) (10 XLM → 1.0561648 USDC)                                                                                                                                                                                                                                                                                                                                        |
| 6   | 11 Sep | sandbox                    | `7d784ee1` | [`CD4GKMF5…6KFZ`](https://stellar.expert/explorer/testnet/contract/CD4GKMF5N2IX5RLFBCE5F3X4CAPD4M5BIIF5OOCVXAYWYMW5DYZQ6KFZ) | [`957f9bc8…`](https://stellar.expert/explorer/testnet/tx/957f9bc89c21821a61c7594010d1e957a91a24166449a381a779e793ce139349) (100 XLM → 10.5613545 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 7   | 11 Sep | sandbox                    | `eb3aa100` | [`CAS57DDJ…RVKO`](https://stellar.expert/explorer/testnet/contract/CAS57DDJDLW3VRKMMYK5IPQWLC6KQEQBA7PI5KZR2PJT4BI4SS5IRVKO) | [`d393d248…`](https://stellar.expert/explorer/testnet/tx/d393d24844103fc6678f52dc6bb16a1a36296b4ffba447033e9c6471dc62332f) (50 XLM → 5.2803423 USDC)                                                                                                                                                                                                                                                                                                                                        |
| 8   | 11 Sep | sandbox                    | `2a419805` | [`CD3I26JV…DX3Z`](https://stellar.expert/explorer/testnet/contract/CD3I26JV527M3GV3RR2Y2CUCHGP3SE4UDT2RQ7AJ7EINUNFXBQ2QDX3Z) | [`079c7516…`](https://stellar.expert/explorer/testnet/tx/079c7516ebdc2f71c7a659af5460ac8b51def0fd33d9307d806b1b4c6b4ba55e) (50 XLM → 5.2802084 USDC)<br>[`1327d15f…`](https://stellar.expert/explorer/testnet/tx/1327d15f9c8008d8f529540dae82511a85f25b9b85d25356dea587ff3b744e77) (50 XLM → 5.2800745 USDC)<br>[`cf401926…`](https://stellar.expert/explorer/testnet/tx/cf4019268431d6b399b1badbc315495792d4c6ff2dbdc9a1673cc32b23819fe4) (50 XLM → 5.2799405 USDC)                        |
| 9   | 11 Sep | sandbox (the recorded run) | `992a754f` | [`CBZ53HMV…QA3V`](https://stellar.expert/explorer/testnet/contract/CBZ53HMVYRCJDDTVOJ73SJ6KFXPUGDWU6TPZM4JJYEYIOC5DRRK5QA3V) | [`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d) (100 XLM → 10.5594796 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 10  | 11 Sep | sandbox                    | `27b4c2e9` | [`CBXLZKQU…XKRE`](https://stellar.expert/explorer/testnet/contract/CBXLZKQUZIBQ4JO7JU74N2F57JRKHLKH7QIQKRXUA5IBMQOH2TCTXKRE) | [`590128ed…`](https://stellar.expert/explorer/testnet/tx/590128ed492ac9da010d0d63110cfcd120c62ca7dc1542728fca084501f56135) (1000 XLM → 105.5653820 USDC)                                                                                                                                                                                                                                                                                                                                    |
| 11  | 11 Sep | sandbox                    | `f8269f58` | [`CCQUJUM3…G4YR`](https://stellar.expert/explorer/testnet/contract/CCQUJUM3GTE6BCZHPTPLW5SC4WC7JIJMOGYK6Y4WWOXMPY5ZWBTYG4YR) | [`b36bb060…`](https://stellar.expert/explorer/testnet/tx/b36bb06098966ac2c7274be08dbca5465d6e8941e32c4298d3d16c5fb56fa5be) (100 XLM → 10.5535904 USDC)<br>[`a6331c04…`](https://stellar.expert/explorer/testnet/tx/a6331c0456acd76727479a418ac06571ebf1a612f1bfa17ff533ceff6f5a7381) (100 XLM → 10.5530552 USDC)                                                                                                                                                                            |
| 12  | 11 Sep | sandbox                    | `8feb8e75` | [`CA3WPY3B…DX5H`](https://stellar.expert/explorer/testnet/contract/CA3WPY3BMHUI5MXQKRUGJE4ZZ22I2GUG7NUPVSAOIDTAIPJ7XUKTDX5H) | [`8ebe2275…`](https://stellar.expert/explorer/testnet/tx/8ebe22756cf53cc19a992e2ad926fb279c660771662cc6589ab3731371b47ada) (100 XLM → 10.5525201 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 13  | 11 Sep | sandbox                    | `bf9ef099` | [`CCJZ3XMB…IQ3D`](https://stellar.expert/explorer/testnet/contract/CCJZ3XMB4ULW5GHTDPBMFSNSIAO3EHKWYJWR5EXYCDDIPS67GJQAIQ3D) | [`6ab282e3…`](https://stellar.expert/explorer/testnet/tx/6ab282e31fd24422ac1d647bdba3ff2124c597e2659b945a026cde3aa659265e) (100 XLM → 10.5519851 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 14  | 11 Sep | sandbox                    | `122213b2` | [`CCWS5BMF…45GR`](https://stellar.expert/explorer/testnet/contract/CCWS5BMFMFZ6GGBI55CXU36OBHUBEPL3ZZB5OAISSESJS74VUKT445GR) | [`bca93ce6…`](https://stellar.expert/explorer/testnet/tx/bca93ce69b1592fc477d3f9f5735ab3eaf6a15293f75dbd01d84946e945b71cb) (100 XLM → 10.5514500 USDC)                                                                                                                                                                                                                                                                                                                                      |
| 15  | 11 Sep | sandbox                    | `e7965d6a` | [`CD2KQNHM…5MDF`](https://stellar.expert/explorer/testnet/contract/CD2KQNHMOQHFSPS5RYDZLTG7NHDO2Y6VQRF2UFCIRS6Y5KTOWJWN5MDF) | [`838373ba…`](https://stellar.expert/explorer/testnet/tx/838373ba332a7a2077c38af523816a6ded49805834fde1f6331c4e380281961d) (1000 XLM → 105.4851198 USDC)                                                                                                                                                                                                                                                                                                                                    |
| 16  | 11 Sep | sandbox                    | `3090cd4b` | [`CDKUIRIA…7LHE`](https://stellar.expert/explorer/testnet/contract/CDKUIRIABBD7RELDHG74Y4DJCS3YOY4OPMZVVJRFZF27A4LMFZJZ7LHE) | [`8a07ac54…`](https://stellar.expert/explorer/testnet/tx/8a07ac5445f19a26388554c32b26d251e965890d33132fe6cb78b26edd968190) (10 XLM → 1.0540171 USDC)                                                                                                                                                                                                                                                                                                                                        |

Every one of these transactions carries the `SoroswapRouter / swap` event from
`CCJUD55A…7BRD`; the checks in the next section apply to each.

This table is the archive database, which stopped changing at the 16 September cutover. Flows
executed since then are on the live database and are listed in
[`swapper-flows-live-2026-09-18.json`](swapper-flows-live-2026-09-18.json): 11 flows and 17 swap
transactions, among them D2's evidence deployment `ad0843d9` (swapper `CD767KMX…YK46`) with both
18 September API swaps, [`b14e8306…`](https://stellar.expert/explorer/testnet/tx/b14e8306ce55741d19e61b32cae5cef9a9abc04259cf3093fe105f4f1a2fbdf7)
and [`27f68188…`](https://stellar.expert/explorer/testnet/tx/27f681889bfebdab92a4d9e6d70770ea5df72bd597c627bc5c0014d0d86bfbfb).
The two lists are never added together; [metrics](../metrics.md#counting-rules) explains why.

## How to verify the router

The Statement of Work asks for a swap executed through **the Soroswap router**. Two things have to
hold: that the transaction called that contract, and that the contract is Soroswap's rather than
one of ours. Each link is checkable without an account, and all four are recorded in
[`d1/11-soroswap-router-proof.json`](d1/11-soroswap-router-proof.json).

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
The recorded run's [`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)
has the same trace from `CBZ53HMV…QA3V`.

**The events corroborate it.** The router emits `SoroswapRouter / swap` and the pair emits
`SoroswapPair / swap` and `sync`. Those symbols are compiled into Soroswap's binaries; Paiflow
cannot emit them. Every one is marked as part of a successful contract call, and the transaction
itself succeeded, so this is applied ledger state and not a simulation.

On the explorer, the quickest check is the transaction's event list: the `SoroswapRouter / swap`
entry names `CCJUD55A…7BRD` as the contract that emitted it, and that contract's own page shows
the code hash to compare against Soroswap's file.

## Screenshots and recordings

Every app capture is from [paiflow.xyz](https://paiflow.xyz) itself, or from beta.app.paiflow.xyz,
the same Railway service ([counting rules](../metrics.md#counting-rules)), not a development
environment. Only one D3 capture, the real-phone shot `d3/13`, is from beta.app. The CI job summary
is a GitHub Actions page rather than the app. The D3 files, their meta records and their numbering are
explained in the [D3 evidence pack](d3/README.md).

| Item                                                                         | Deliverable | File                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Screen recording of deploy and trigger** (11 Sep)                          | D1          | [Google Drive, `ScreenRec.mp4`](https://drive.google.com/file/d/1hcaNcojXrLmEYmTEHrNavQ_Wu9xgqaHL/view?usp=sharing)                                                                                                                                                                                                         |
| **Screen recording of building a Swapper flow with the new inputs** (25 Sep) | D3          | [Google Drive, `D3`](https://drive.google.com/file/d/1bcZP0jpYhn_9kdQzs73kr01DpXBeXn2Y/view?usp=sharing) — record in [`d3/19-recording-run.json`](d3/19-recording-run.json)                                                                                                                                                 |
| Swap block on the canvas, palette and English preview                        | D1          | [`d1/01-builder-swap-flow.png`](d1/01-builder-swap-flow.png)                                                                                                                                                                                                                                                                |
| Swapper config panel: router, slippage, deadline                             | D1          | [`d1/02-swap-panel-after.png`](d1/02-swap-panel-after.png)                                                                                                                                                                                                                                                                  |
| Error: `assetIn` does not match the incoming asset                           | D1          | [`d1/03-error-asset-mismatch.png`](d1/03-error-asset-mismatch.png)                                                                                                                                                                                                                                                          |
| Error: more than one outgoing edge                                           | D1          | [`d1/04-error-two-edges.png`](d1/04-error-two-edges.png)                                                                                                                                                                                                                                                                    |
| Error: both sides of the swap are the same asset                             | D1          | [`d1/06-error-same-asset.png`](d1/06-error-same-asset.png)                                                                                                                                                                                                                                                                  |
| Deploy review with the TESTNET chip and the live quote                       | D1          | [`d1/07-deploy-review.png`](d1/07-deploy-review.png)                                                                                                                                                                                                                                                                        |
| Live Soroswap quote in the config panel                                      | D1          | [`d1/08-swap-panel-live-quote.png`](d1/08-swap-panel-live-quote.png)                                                                                                                                                                                                                                                        |
| Live quote on the builder canvas                                             | D1          | [`d1/09-builder-live-quote.png`](d1/09-builder-live-quote.png)                                                                                                                                                                                                                                                              |
| **Swapper panel before and after D3, side by side**                          | D3          | [`d3/17-swap-panel-before-after.png`](d3/17-swap-panel-before-after.png)                                                                                                                                                                                                                                                    |
| After D3: the Swapper panel with the live quote (25 Sep)                     | D3          | [`d3/06-swap-panel-after.png`](d3/06-swap-panel-after.png) — provenance in [`d3/03-18-after-meta.json`](d3/03-18-after-meta.json)                                                                                                                                                                                           |
| After D3: the builder with the panel open                                    | D3          | [`d3/05-builder-after.png`](d3/05-builder-after.png)                                                                                                                                                                                                                                                                        |
| After D3: the panel opened with Enter, focus on its heading                  | D3          | [`d3/03-keyboard-open-desktop.png`](d3/03-keyboard-open-desktop.png), [`d3/03-keyboard-open-mobile.png`](d3/03-keyboard-open-mobile.png)                                                                                                                                                                                    |
| After D3: the same-asset error, reached from the keyboard                    | D3          | [`d3/04-keyboard-error-desktop.png`](d3/04-keyboard-error-desktop.png), [`d3/04-keyboard-error-mobile.png`](d3/04-keyboard-error-mobile.png)                                                                                                                                                                                |
| After D3: the 0.3% slippage floor error on the shared input                  | D3          | [`d3/15-slippage-error-desktop.png`](d3/15-slippage-error-desktop.png), [`d3/15-slippage-error-mobile.png`](d3/15-slippage-error-mobile.png)                                                                                                                                                                                |
| After D3: Advanced open, the pinned Soroswap router and the deadline         | D3          | [`d3/16-swap-panel-advanced-after-desktop.png`](d3/16-swap-panel-advanced-after-desktop.png), [`d3/16-swap-panel-advanced-after-mobile.png`](d3/16-swap-panel-advanced-after-mobile.png)                                                                                                                                    |
| After D3: the docked sheet on a Pixel 7, and scrolled to its foot            | D3          | [`d3/07-docked-sheet-mobile.png`](d3/07-docked-sheet-mobile.png), [`d3/08-docked-sheet-scrolled-mobile.png`](d3/08-docked-sheet-scrolled-mobile.png)                                                                                                                                                                        |
| Real phone, `Max slippage (%)` focused with the keyboard up (25 Sep)         | D3          | [`d3/13-phone-keyboard-up.jpg`](d3/13-phone-keyboard-up.jpg) — record in [`d3/13-phone-meta.json`](d3/13-phone-meta.json)                                                                                                                                                                                                   |
| Contrast: the Pay panel, not migrated, in the same viewport                  | D3          | [`d3/18-pay-panel-legacy-desktop.png`](d3/18-pay-panel-legacy-desktop.png), [`d3/18-pay-panel-legacy-mobile.png`](d3/18-pay-panel-legacy-mobile.png)                                                                                                                                                                        |
| Before D3: slippage focused from the keyboard, default outline only (22 Sep) | D3          | [`d3/09-swap-panel-keyboard-focus-before.png`](d3/09-swap-panel-keyboard-focus-before.png) — provenance in [`d3/09-14-before-meta.json`](d3/09-14-before-meta.json)                                                                                                                                                         |
| Before D3: typing `0.5` into slippage ends as `0.35`                         | D3          | [`d3/10-slippage-typing-before-1.png`](d3/10-slippage-typing-before-1.png), [`d3/10-slippage-typing-before-2.png`](d3/10-slippage-typing-before-2.png), [`d3/10-slippage-typing-before-3.png`](d3/10-slippage-typing-before-3.png) — keystrokes in [`d3/10-slippage-typing-before.json`](d3/10-slippage-typing-before.json) |
| Before D3: the same-asset error, not announced                               | D3          | [`d3/11-same-asset-error-before.png`](d3/11-same-asset-error-before.png)                                                                                                                                                                                                                                                    |
| Before D3: the router as a one-option select                                 | D3          | [`d3/12-router-select-before.png`](d3/12-router-select-before.png)                                                                                                                                                                                                                                                          |
| Before D3: Enter, Space and Escape do not open or close the panel            | D3          | [`d3/14-keyboard-open-close-before.gif`](d3/14-keyboard-open-close-before.gif)                                                                                                                                                                                                                                              |
| Pre-sprint baseline: the Swapper panel **before D1** (9 Sep)                 | D1 baseline | [`d3/02-swap-panel-before.png`](d3/02-swap-panel-before.png)                                                                                                                                                                                                                                                                |
| Pre-sprint baseline: the builder with the pre-D1 swap node selected (9 Sep)  | D1 baseline | [`d3/01-builder-before.png`](d3/01-builder-before.png)                                                                                                                                                                                                                                                                      |
| Pre-sprint baseline: the palette before the Swap block was unhidden (9 Sep)  | D1 baseline | [`d3/00-palette-before.png`](d3/00-palette-before.png)                                                                                                                                                                                                                                                                      |
| CI job summary for the component tests (public mirror run, 24 Sep)           | D3          | [`d3/21-ci-summary.png`](d3/21-ci-summary.png)                                                                                                                                                                                                                                                                              |
| PostHog swap validation errors before and after the D3 promotion (25 Sep)    | D3          | [`d3/22-posthog-validation.json`](d3/22-posthog-validation.json)                                                                                                                                                                                                                                                            |
| API access panel, the minted token by its prefix only                        | D2          | [`d2/api-access-panel.png`](d2/api-access-panel.png)                                                                                                                                                                                                                                                                        |
| stellar.expert invocation tree for the API swap                              | D2          | [`d2/07-stellar-expert-swap.png`](d2/07-stellar-expert-swap.png)                                                                                                                                                                                                                                                            |
| Postman collection run against paiflow.xyz                                   | D2          | [`d2/09-postman-run.png`](d2/09-postman-run.png)                                                                                                                                                                                                                                                                            |

The recording is the journey the SOW asks for, made on paiflow.xyz through the no-account
sandbox: build `Receive XLM → Swap → Pay USDC` in the builder, deploy it with a browser wallet,
and fund the trigger. It shows the outcome by the recipient's USDC balance before and after the
trigger rather than by opening the explorer; the transaction behind it is
[`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)
(100 XLM → 10.5594796 USDC), deployed by
[`c0460040…`](https://stellar.expert/explorer/testnet/tx/c04600408d910f55639a09b54725f65b38881820bbd468358be6546ce3416f18),
with the raw records in [`d1/13-recording-run.json`](d1/13-recording-run.json) and [`d1/13-recording-run.getTransaction.json`](d1/13-recording-run.getTransaction.json).

The D3 recording (7:19, narrated with captions) is the same journey on the rebuilt panel, from a
registered account rather than the sandbox: build `Receive XLM → Swap → Split USDC`, then use each
Swapper input on camera — the asset-mismatch and same-asset errors appearing and clearing, slippage
raised to the 0.3% floor and lowered from 200% on blur, the preview amount re-quoting live, and
Advanced with the pinned Soroswap router opened on stellar.expert. It deploys with Freighter, triggers
with 50 XLM ([`34048835…`](https://stellar.expert/explorer/testnet/tx/34048835187d7d4c66d496e35bbb4994caee88a82b362131ac5b260d52baeb31),
50 XLM → 5.2731437 USDC, split 60/40), shows a short keyboard pass over the canvas, and ends with a
phone take of the docked sheet. [`d3/19-recording-run.json`](d3/19-recording-run.json) has the
timestamps, the pipeline and the amounts, and
[`d3/19-recording-run.getTransaction.json`](d3/19-recording-run.getTransaction.json) the raw RPC
responses for both transactions.

**Which screenshot is D3's "before".** D3 rebuilt the panel D1 shipped, so D3's "before" is D1's
"after" ([`d1/02-swap-panel-after.png`](d1/02-swap-panel-after.png) and
[`d1/08-swap-panel-live-quote.png`](d1/08-swap-panel-live-quote.png)) plus `d3/09`–`14`. Those are
the same D1 panel on paiflow.xyz on 22 September, captured to show what D3 fixes in it. Its "after"
is `d3/03`–`08` and `15`–`18`, and [`d3/17`](d3/17-swap-panel-before-after.png) puts the two side by
side. The three 9 September files `d3/00`–`02` are older than both: they show the **pre-D1** panel
(`Asset In`, `Asset Out` and a raw `Rate (basis points, 1–10000)`, with no slippage, no deadline and
no router). They are kept as the pre-sprint baseline. They are D1's "before", not D3's, and the
fields that differ between them and today's panel are D1's work. The
[D3 evidence pack](d3/README.md) pairs each D3 "before" with its "after".

### The captures

Each screenshot in the table, in order. Every one was taken from paiflow.xyz, except the real-phone
shot `d3/13` (beta.app.paiflow.xyz, the same service) and the CI job summary (GitHub Actions).

![Swap block on the canvas, with the palette and the English preview](d1/01-builder-swap-flow.png)

_Swap block on the canvas, with the palette and the English preview._

![Swapper config panel: read-only Soroswap router, max slippage, deadline](d1/02-swap-panel-after.png)

_Swapper config panel: read-only Soroswap router, max slippage, deadline._

![Validation error: the swap's asset in does not match the incoming asset](d1/03-error-asset-mismatch.png)

_Validation error: the swap's asset in does not match the incoming asset._

![Validation error: a swap block with more than one outgoing edge](d1/04-error-two-edges.png)

_Validation error: a swap block with more than one outgoing edge._

![Validation error: both sides of the swap are the same asset](d1/06-error-same-asset.png)

_Validation error: both sides of the swap are the same asset._

![Deploy review with the TESTNET chip and the live quote](d1/07-deploy-review.png)

_Deploy review with the TESTNET chip and the live quote._

![Live Soroswap quote in the config panel](d1/08-swap-panel-live-quote.png)

_Live Soroswap quote in the config panel._

![Live quote on the builder canvas](d1/09-builder-live-quote.png)

_Live quote on the builder canvas._

![Side by side: the Swapper panel before D3 on the left, with slippage focused, and after D3 on the right, with Advanced open](d3/17-swap-panel-before-after.png)

_Side by side: the Swapper panel before D3 on the left, with slippage focused, and after D3 on the right, with Advanced open._

![After D3: the Swapper panel built from the shared inputs, with the live quote loaded](d3/06-swap-panel-after.png)

_After D3: the Swapper panel built from the shared inputs, with the live quote loaded._

![After D3: the desktop builder with the Swapper panel open over the canvas](d3/05-builder-after.png)

_After D3: the desktop builder with the Swapper panel open over the canvas._

![After D3, desktop: the panel opened with Enter on the focused Swap node, focus on the Swap settings heading](d3/03-keyboard-open-desktop.png)

_After D3, desktop: the panel opened with Enter on the focused Swap node, focus on the Swap settings heading._

![After D3, phone: the same, in the docked sheet](d3/03-keyboard-open-mobile.png)

_After D3, phone: the same, in the docked sheet._

![After D3, desktop: Asset Out moved onto XLM from the keyboard, the same-asset error under the control](d3/04-keyboard-error-desktop.png)

_After D3, desktop: Asset Out moved onto XLM from the keyboard, the same-asset error under the control._

![After D3, phone: the same-asset error in the docked sheet](d3/04-keyboard-error-mobile.png)

_After D3, phone: the same-asset error in the docked sheet._

![After D3, desktop: a flow saved at 0.1% slippage shows the 0.3% floor error on the shared input](d3/15-slippage-error-desktop.png)

_After D3, desktop: a flow saved at 0.1% slippage shows the 0.3% floor error on the shared input._

![After D3, phone: the slippage floor error in the docked sheet](d3/15-slippage-error-mobile.png)

_After D3, phone: the slippage floor error in the docked sheet._

![After D3, desktop: Advanced open, the pinned Soroswap router with its short id, copy button and explorer link, and the deadline](d3/16-swap-panel-advanced-after-desktop.png)

_After D3, desktop: Advanced open, the pinned Soroswap router with its short id, copy button and explorer link, and the deadline._

![After D3, phone: Advanced open in the docked sheet](d3/16-swap-panel-advanced-after-mobile.png)

_After D3, phone: Advanced open in the docked sheet._

![After D3: the Swapper panel as a bottom sheet on a Pixel 7, with the live quote](d3/07-docked-sheet-mobile.png)

_After D3: the Swapper panel as a bottom sheet on a Pixel 7, with the live quote._

![After D3: the same sheet scrolled to its foot, the live quote in the ticket](d3/08-docked-sheet-scrolled-mobile.png)

_After D3: the same sheet scrolled to its foot, the live quote in the ticket._

![Real phone: Max slippage focused with the keyboard up, the field and its hint still visible above it](d3/13-phone-keyboard-up.jpg)

_Real phone: Max slippage focused with the keyboard up, the field and its hint still visible above it._

![Contrast, desktop: the Pay panel, not migrated, still on the legacy asset select, payout-mode select and checkbox](d3/18-pay-panel-legacy-desktop.png)

_Contrast, desktop: the Pay panel, not migrated, still on the legacy asset select, payout-mode select and checkbox._

![Contrast, phone: the legacy Pay panel in the docked sheet](d3/18-pay-panel-legacy-mobile.png)

_Contrast, phone: the legacy Pay panel in the docked sheet._

![Before D3: the slippage field focused from the keyboard with only the browser's default outline (22 Sep)](d3/09-swap-panel-keyboard-focus-before.png)

_Before D3: the slippage field focused from the keyboard with only the browser's default outline (22 Sep)._

![Before D3: typing 0.5 into slippage, first key, 0 already rewritten to 0.3](d3/10-slippage-typing-before-1.png)

_Before D3: typing 0.5 into slippage, first key, 0 already rewritten to 0.3._

![Before D3: second key, the decimal point, still 0.3](d3/10-slippage-typing-before-2.png)

_Before D3: second key, the decimal point, still 0.3._

![Before D3: third key, 5, and the field ends as 0.35](d3/10-slippage-typing-before-3.png)

_Before D3: third key, 5, and the field ends as 0.35._

![Before D3: the same-asset error under Asset Out, with nothing to announce it to a screen reader](d3/11-same-asset-error-before.png)

_Before D3: the same-asset error under Asset Out, with nothing to announce it to a screen reader._

![Before D3: the router as a disabled select with one option and no contract id](d3/12-router-select-before.png)

_Before D3: the router as a disabled select with one option and no contract id._

![Before D3: the Swap node reached by Tab, Enter and Space not opening the panel, Escape not closing it](d3/14-keyboard-open-close-before.gif)

_Before D3: the Swap node reached by Tab, Enter and Space not opening the panel, Escape not closing it._

![Pre-sprint baseline, before D1: the swapper panel with a raw rate field (9 Sep)](d3/02-swap-panel-before.png)

_Pre-sprint baseline, before D1: the swapper panel with a raw rate field (9 Sep)._

![Pre-sprint baseline, before D1: the builder with the old swap node selected (9 Sep)](d3/01-builder-before.png)

_Pre-sprint baseline, before D1: the builder with the old swap node selected (9 Sep)._

![Pre-sprint baseline, before D1: the palette without the Swap block (9 Sep)](d3/00-palette-before.png)

_Pre-sprint baseline, before D1: the palette without the Swap block (9 Sep)._

![CI: the node job summary for the public mirror run of the #670 merge, 1756 tests passing](d3/21-ci-summary.png)

_CI: the node job summary for the public mirror run of the #670 merge, 1756 tests passing._

## API samples and records

Request and response pairs recorded against the public app, and D3's code and CI records.

| Item                                                            | Deliverable | File                                                                 |
| --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| `slippageBps` outside 0–10000 rejected at the API boundary      | D1          | [`d1/05-error-slippage-range.json`](d1/05-error-slippage-range.json) |
| `deadlineSecs` below 1 rejected at the API boundary             | D1          | [`d1/06-error-deadline.json`](d1/06-error-deadline.json)             |
| Live Soroswap quote endpoint response                           | D1          | [`d1/10-quote-endpoint.json`](d1/10-quote-endpoint.json)             |
| curl transcript: prepare → local sign → submit → events         | D2          | [`d2/01-curl-transcript.md`](d2/01-curl-transcript.md)               |
| Prepare response: the unsigned envelope                         | D2          | [`d2/02-prepare-response.json`](d2/02-prepare-response.json)         |
| Submit response: `SUCCESS` and the swap hash                    | D2          | [`d2/03-submit-response.json`](d2/03-submit-response.json)           |
| Raw RPC `getTransaction` for the API swap                       | D2          | [`d2/04-getTransaction.json`](d2/04-getTransaction.json)             |
| Events response, then the feed paged with the cursor            | D2          | [`d2/05-events-response.json`](d2/05-events-response.json)           |
| Audit rows: prepared, submitted, confirmed (redacted)           | D2          | [`d2/06-audit-rows.json`](d2/06-audit-rows.json)                     |
| The OpenAPI document as committed on 18 September               | D2          | [`d2/08-openapi.json`](d2/08-openapi.json)                           |
| Demo token minted with no account, then used on `/events`       | D2          | [`d2/11-demo-token.md`](d2/11-demo-token.md)                         |
| The Swapper panel's change in code, each claim with its command | D3          | [`d3/20-code-diff.md`](d3/20-code-diff.md)                           |
| Component tests: the CI junit report                            | D3          | [`d3/21-vitest-junit.xml`](d3/21-vitest-junit.xml)                   |
| That CI run: URL, SHAs, Node version, artifact digest, counts   | D3          | [`d3/21-ci-meta.json`](d3/21-ci-meta.json)                           |

The quote sample is a real answer from the public app: 10 XLM quotes at `10564278` stroops of
USDC with a `10490132` minimum at 1 % slippage, through pair `CCBX3NZT…7RQS` on router
`CCJUD55A…7BRD`.

## Metrics snapshots

| Date   | File                                                                       | Source                                                                                           |
| ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 11 Sep | [`metrics-2026-09-11.json`](metrics-2026-09-11.json)                       | Read-only query on the public app's database; each figure carries its definition                 |
| 12 Sep | [`metrics-2026-09-12.json`](metrics-2026-09-12.json)                       | Same query, re-run at the close of week 1; each figure also carries its target                   |
| 17 Sep | [`alpha-metrics-2026-09-17.json`](alpha-metrics-2026-09-17.json)           | PostHog HogQL over the issued alpha-tester ids; first cohort snapshot                            |
| 18 Sep | [`alpha-metrics-2026-09-18.json`](alpha-metrics-2026-09-18.json)           | The same, after the second tester finished                                                       |
| 18 Sep | [`metrics-live-2026-09-18.json`](metrics-live-2026-09-18.json)             | The first read of the **live** database, the one the app has used since the 16 September cutover |
| 18 Sep | [`swapper-flows-live-2026-09-18.json`](swapper-flows-live-2026-09-18.json) | `--flows` against the same database: 11 executed swapper flows, 17 swap transactions             |

The `metrics-*` files are the output of `pnpm instawards:metrics` and the `alpha-metrics-*` files
of `pnpm instawards:alpha-metrics`, so any figure here can be recomputed with the same definitions.

**Two databases, and each snapshot says which it read.** The 11 and 12 September files are the
Postgres now kept as `postgres-staging-archive`, frozen at the 16 September cutover. The
18 September live file is the database the application uses now. They hold different rows and are
never added together; [metrics](../metrics.md#counting-rules) explains why.

## Scope

Only transactions produced from [paiflow.xyz](https://paiflow.xyz) during the sprint are
listed here, and only those count toward the [metrics](../metrics.md).
