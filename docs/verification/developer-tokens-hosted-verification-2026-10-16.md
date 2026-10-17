# Hosted developer-token verification — 2026-10-16

The core developer-token journey passed on the hosted testing environment: one
credential across two selected deployments, authorization isolation, real wallet
payments, pending recovery, replay protection and retirement isolation. This
report consolidates the access/wallet working reports and decisions for
[#1028](https://github.com/webnxt-2030/pinkraft/issues/1028) and
[#1034](https://github.com/webnxt-2030/pinkraft/issues/1034).
The [fee investigation](developer-tokens-hosted-fee-investigation-2026-10-16.md)
retains the separate shared-code renewal analysis and independent chain proof.

## Exact target and artifacts

| Item                      | Tested value                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| App commit                | `bc89f5dd8d816bb60295a9d5bc296fc5d9627508` on `dev-token`                                |
| Railway project           | `576ef2f5-16ec-4778-bdef-dca18f14d04b`                                                   |
| Testing environment       | `881ead44-6cfc-4249-97dd-492b9f5e2c53`                                                   |
| App service               | `78c1d697-51be-4bf4-ab21-e79b240b162c`                                                   |
| Railway deployment        | `13354809-6c8d-411e-b78b-146f6c55a209`                                                   |
| HTTPS origin              | `https://pinkraft.xyz`                                                                   |
| Chain                     | Stellar testnet; wallet independently reported `Test SDF Network ; September 2015`       |
| Installed SDK             | Branch-built `@paiflow/sdk` 0.1.0 tarball; Unreleased source, not a registry publication |
| SDK tarball SHA-256       | `d78ba6036521ca201ec0612684c45f9b5143cec0889d5817057f9783f7b59cb4`                       |
| Wallet                    | Official Freighter 5.49.0 in an isolated Chromium extension profile                      |
| Freighter archive SHA-256 | `2e9371c0fe00b01c8bf1389aa2a63755e7ceb44ab15c857fc0eee5adfebb7e7d`                       |

Repeated health gates returned `bc89f5d`, HTTP 200 and status/database/Redis/RPC
`ok`. Registration and sandbox were disabled. Before authorized account insertion,
credential comparisons in program memory established that the app used its
identified testing PostgreSQL instance and differed from staging. Service names
were not used as the isolation boundary. Staging received no writes or
configuration changes during these tests; mainnet was not used.

The tested app commit above predates this documentation-only consolidation.
This report does not claim that later merge commits or staging were live-tested.
Earlier automated/local evidence remains separately recorded in
[the integration verification](developer-tokens-2026-10-16.md).

## Controlled fixtures

Two ordinary test users were provisioned directly in the testing DB with explicit
user authorization, random usernames and argon2id passwords. All flows,
deployments, credentials and financial/lifecycle mutations then used supported
application APIs. No deployment/financial records, ownership, terminal outcomes,
expiry timestamps or inactive-user flags were fabricated by direct DB writes.

The throwaway wallet was created through normal Freighter UI; **Do this later**
skipped backup without opening or exporting a recovery phrase or private key.
Its public address is `GAPQDCRQ3UXVOSHQI3DJ3XXOCIIHA3IUSYXXH7BQNMWTA2GGH6CU2XFC`.
All fixtures used native Receive → full native Pay back to that controlled wallet.
Deployment fees below are envelope ceilings, not measured net charges.

| Fixture | Purpose                               | Deployment                             | Deployment transaction                                             | Fee ceiling, XLM |
| ------- | ------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ | ---------------: |
| A1      | First selected owned deployment       | `a0f52b95-7caf-4b8d-9ea6-e63b6d1fbc45` | `0e58c7b27294457ba9a34186401169219f51dd8a0ebee7ea7a2f73311299009d` |        0.0844817 |
| A2      | Second selected owned deployment      | `dfdc602d-efc3-453c-ad4e-ee9fa7c68851` | `fc2704696e8a4ad311b2eca3a2e2ef68bc7989ddc4839a16e1df508e94067fcc` |        0.0845048 |
| A3      | Initially unselected owned deployment | `83c25bd6-44e4-4af6-bf46-387cb1b42b36` | `4171f68d15a027cd5ca45deac7b05b03a85a50ca01b326df9e65198b03144a22` |        0.0845047 |
| B       | Foreign owner's deployment            | `d8a0c349-f6b6-49fe-b613-c90f5041c2a8` | `4f4ab321d9e61a92ba51cb6dce1a2a4bbc3061f313d5080772fa52cb3009016f` |        0.0845047 |
| A4      | Future-deployment/retirement test     | `9385c38e-e12f-4ca8-af31-ddb2a5ef27f6` | `c2818150eee6b16092ee8cd881ca9c2221087b143968fdc4bdfd75f8ccf54103` |        0.0847796 |

Fresh chain reads verified configured factory/code hashes against the prepared
constructor arguments. Each exact body, fee, network, recipient and signed hash
was checked before submission. This is configuration/chain consistency evidence,
not a new reproducible WASM build or contract audit.

## Hosted app, API and installed-SDK results

| Surface                  | Observed result                                                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel lifecycle          | Real login; keyboard token creation for two selections; reveal focus and `ph-no-capture`; actual clipboard readback matched in memory and clipboard cleared; Done/navigation removed the secret; grant edits and UI revocation succeeded.    |
| Accessibility            | Whole-page axe found zero violations and no horizontal overflow at widths 1440 and 393; Generate-button contrast measured 7.746:1.                                                                                                           |
| Metadata/secret handling | Metadata used `Cache-Control: no-store`; no full credential or stored token hash in metadata/browser console. No secret-bearing screenshots, traces, videos, DOM snapshots or request dumps were captured.                                   |
| Deployment isolation     | Both selections returned capabilities 200. Unselected owned and foreign deployments returned generic 401 without disclosing their requested ID. Real failed preparation was excluded from eligible selections; selecting it returned 422.    |
| Installed SDK            | One installed client/credential paginated discovery one item at a time over exactly two selections; summaries had only `id`, `flowName`, `network`. Capabilities, balances and events worked on both real deployments.                       |
| Read-only permission     | All **23** POST operate routes in the exhaustive matrix returned 403 with empty request bodies, before domain-body validation; no extra execute-prepared audit was created by those refusals.                                                |
| Management boundary      | Unauthenticated/bearer-only management returned 401; another owner's GET/PATCH/DELETE of the token returned 404.                                                                                                                             |
| Validation/immutability  | Empty create selections, malformed IDs, invalid permission, injected owner, foreign/duplicate selections and attempts to mutate permission/label/expiry returned 422.                                                                        |
| Immediate access changes | Warmed missing grant became usable immediately on addition; removal returned 401 while another selection worked. Empty edited selections suspended access; explicit restoration resumed it. Revocation immediately refused a warmed request. |
| Shared allowance         | A fresh token alternated two deployment IDs for 60 successful capabilities requests; request 61 returned 429. Selection count did not multiply that endpoint's allowance.                                                                    |
| Compatibility            | A supported-API-minted `pfk_` read its bound deployment and refused the other; it was revoked. A `pkdev_`-shaped credential was refused by v1.                                                                                               |

Read-only inspection inside the existing testing service found **112 queued Redis
request records** scoped to the two accounts, with expected developer/deployment
caller families and 200/401/403/429 statuses. Developer token IDs belonged to the
recorded account and had legacy `apiTokenId: null`; networks were testnet. Records
contained only expected metadata, without complete run credentials, stored token
hashes or signed-envelope/password/authorization/cookie fields. The persisted
request table had zero matching rows: queue-to-DB delivery remains **unverified**.
No queue flush, cron invocation or public Redis exposure was used.

## Real payments, recovery and replay

The initial unsigned A1 0.1 XLM preparation quoted **46.8961462 XLM**, above the
original **1 XLM per-transaction ceiling**. Testing stopped before signing it.
Independent unsigned simulations isolated shared PAYER-code TTL renewal as about
99.67% of a fresh full resource-fee quote. The user then explicitly authorized
continuing analogous attributed shared-template renewal cases. Ordinary unrelated
fees retained their ceiling. No runtime fee guard, TTL policy, contract or Railway
variable changed, and no maintenance payment prepaid the renewal.

Fresh preparations were checked before normal Freighter approval. An intentional
Cancel produced SDK `PaiflowSigningError` without a submit. Two separately approved
**0.1 XLM** payments subsequently succeeded:

| Fixture | Payment hash                                                       |  Ledger | Declared fee, XLM | Refund, XLM | Net charged, XLM |
| ------- | ------------------------------------------------------------------ | ------: | ----------------: | ----------: | ---------------: |
| A1      | `f77ab49e11ec50aa73898b2bbd3fac5c180934c7c8172242738493b577ff10c5` | 5223825 |        47.0776248 |   6.1223426 |       40.9552822 |
| A2      | `036640f07fbfee7f809c1bfe81722f3c5fcbdcc1d86f84e50b8d9518f2a10496` | 5223844 |         0.1573647 |   0.0208338 |        0.1365309 |

Independent public RPC receipts confirmed SUCCESS and fee reconciliation: initial
debit minus refund equals net `feeCharged`; refunds are not subtracted twice.
Confirmed native-token events traced exactly **1,000,000 stroops** along wallet →
trigger → PAYER → same wallet, plus matching deposit/pay events. This proves the
recipient amount, not a net wallet gain; the round-trip wallet pays the fee.
The original 46.8961462 quote was never submitted and is not an actual charge.

A1 renewed shared PAYER code from live-until 5254427 to **5723825**, exactly
payment ledger 5223825 + 500,000. A2 then avoided that shared renewal. These are
observations for these transactions, not a general production fee predictor.

- After signing A1 but before sending, grant removal refused the exact envelope
  with 401. Restoring the explicit grant permitted its deliberate initial send.
- That send with `wait: false` returned naturally **PENDING**. The original token
  was revoked; a replacement explicitly selecting A1/A2 first read PENDING, then
  SUCCESS by the original hash. No fake finality, DB outcome edits or dropped RPC
  responses were used.
- A read-only DB transaction independently confirmed the original developer-token
  attribution remained, legacy `apiTokenId` and `userId` stayed null, and caller
  account, signer, deployment and testnet matched. Replacement did not overwrite
  first attribution.
- After independent SUCCESS, an explicit same-envelope retry returned the same
  SUCCESS/hash/ledger. Submitting that A1 envelope against A2 returned 422; A1
  retained its original two event IDs. No replacement payment was created.
- One replacement SDK client read both SUCCESS receipts and both deployments'
  real hosted events. A2's initially empty event page resolved on a later read;
  collection lag did not prompt resubmission.

## Future grants, retirement and final state

A4 was created at **09:27:26.914 UTC**, after the replacement token's
**09:25:07.838 UTC** creation. That credential's discovery excluded A4 and its
capabilities returned 401. Explicit owner grant addition immediately enabled it
through the same SDK client. Deployment creation alone never granted access.

A4 never prepared or submitted a payment. Independent chain reads found zero
native trigger/PAYER balances. Read-only settlement inventories found no unfinished
work, pending service transactions, reserved controls, unresolved signed records,
payouts, unrecovered cash-outs or running streamer claims. Retirement was initially
rejected by automatic approval review before execution because the irreversible
mutation lacked explicit authorization for that fixture. The user subsequently
approved that specific retirement; no bypass was used.

The supported owner retirement POST at **09:39:50.872–09:39:53.074 UTC** returned
200, RETIRED and no blocker, with the handler rechecking its settlement boundary
under lock. The same selected token then received 401 for A4, and discovery
contained exactly A1/A2; both still returned capabilities 200 and original SUCCESS
receipts. Read-only DB evidence preserved A4's graph/pipeline hashes, deployment
transaction and confirmed signed record, plus original and retirement audits.
The subsequent owner GET 404 reflected route behavior, not deletion.

Final inventory at **09:39:54.860 UTC** found **all nine developer credentials and
one legacy deployment credential revoked, zero active**. Both payments were
CONFIRMED; no accepted payment remained pending or unknown. The original four
fixtures remained CONFIRMED/ACTIVE; only A4 was RETIRED (cutoff ledger 5224000).
Accounts, deployments and financial/audit history were retained. Browsers were
closed; credential/session/profile artifacts remained restricted outside git.

## Decisions, interruptions and coverage limits

- One actual deployment simulation hit a 10-second RPC timeout and left failed row
  `be7f9f79-c5d1-4667-8d3d-1d1ed4e34b69`. After fresh health checks, one deliberate
  new unsigned preparation succeeded. Failed history was retained; no automatic
  financial POST retry or application fix was introduced.
- An initial automated label locator failed after metadata showed a null label.
  A synchronized repeat waited for initial management fetch, used normal keyboard
  input and asserted input/create/metadata labels in memory; it passed without a
  source change. The original failure's cause remains unconfirmed.
- A read-only health guard failed without retaining enough response detail to
  identify its cause; independent rechecks returned healthy. A later A4 pre-sign
  health GET timed out; an explicit healthy reread preceded wallet approval of
  the still-valid preparation. Neither observation establishes deployment drift.
- **Natural token expiry was explicitly excluded.** Hosted inactive-owner and
  sandbox-session enforcement were not exercised; sandbox was disabled and owner
  flags were not directly edited to manufacture evidence.
- Positive enabled-webhook authentication, Schedule/Subscription controls,
  relayer early release and payout workflows remain unverified by these native
  fixtures. A bearer-only native Receive webhook request returning 422 does not
  establish webhook-secret authentication. Read-only permission refusals do not
  establish positive operation behavior.
- Redis-to-database request-history delivery and other browser engines remain
  unverified. Local simulated tests are separate evidence.

No application source change, contract upload, SDK publication or staging
promotion was performed as part of this hosted run. Later promotion must identify
its own exact commits, CI results and deployment-health evidence.
