# InstaAwards Builder Showcase working memory

Updated October 8, 2026.

## Current state and requirements

- Showcase: **October 8, 2026, 7:30 PM–9:30 PM PHT**, Google Meet.
- Presentation: **five minutes, no Q&A**; the user presents and operates the demo solo.
- Demo **must be live**. Recordings and historical receipts support claims but cannot replace it.
- Current five-slide deck and timed speaker notes are complete and visually checked. **Live-demo setup and rehearsal remain pending**; current app, wallet, network and external evidence-link readiness have not been verified.
- No additional organizer format or judging criteria provided. Confirm the presentation slot and Meet link.
- Presentation sequence: https://docs.google.com/spreadsheets/d/1cKM2Js49aUa2OePoVsSwJGAYq4CajPToqzGAUOifITw/edit?usp=sharing

## Current artifacts

- PowerPoint: `docs/showcase/paiflow-showcase-webinar-design.pptx`.
- PDF preview: `docs/showcase/paiflow-showcase-webinar-design.pdf`.
- Build source, speaker notes and backgrounds: `docs/showcase/webinar-design/`.
- Rebuild from repo root: `PAIFLOW_PPTXGENJS="$PWD/../../claude-webinar/slides-build/node_modules/pptxgenjs" node docs/showcase/webinar-design/build.cjs`, or point the variable at another installed pptxgenjs.
- The superseded original deck was removed; use the webinar-design files above.
- Five slides: Paiflow introduction, sprint achievements, live-demo cue, alpha results → October forecast, planned events/closing.
- Current design: Paiflow pink/blue on deep black, connected payment blocks, shortened achievements emphasizing swaps/API, and a demo slide showing the flow with LIVE/TESTNET label.
- Forecast bars use solid pink for baseline and dashed extensions for increases, with deltas inside. **Each bar scales independently to its own minimum October target**, as labeled on the slide and in notes.
- All five slides and speaker-note package were validated after the final refinements.

## Presentation timing and live-demo preparation

Central message: Draw a payment flow, sign with your own wallet, and run it through the builder or an API. This month added real swaps, clearer inputs and verifiable testnet evidence.

| Time      | Content                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| 0:00–0:30 | Introduction and problem.                                                                                    |
| 0:30–1:05 | InstaAwards progress.                                                                                        |
| 1:05–3:30 | Required live On Receive → Swap → Pay demo.                                                                  |
| 3:30–4:00 | Alpha results: 9 active testers (8 external), 42 deployments, 73 signed transactions, 7 executed swap flows. |
| 4:00–4:15 | Forecast: highlight 45+ users, 110+ deployments, 190+ signed transactions.                                   |
| 4:15–4:40 | Planned events.                                                                                              |
| 4:40–4:50 | Closing and app/evidence links.                                                                              |
| 4:50–5:00 | Buffer.                                                                                                      |

- Prepare one prebuilt, predeployed On Receive (XLM) → Swap → Pay (USDC) flow. Live construction/deployment is not a confirmed requirement.
- Confirm demo-account and testnet-wallet access, funding, recipient USDC trustline, wallet connection and browser tabs.
- Show canvas, live quote, a useful validation example, deployment review, wallet-signed execution, payout events and explorer receipt. Rehearse actual signing/confirmation timing within the demo window and the whole presentation within 4:50.
- Cover API execution verbally as a shipped achievement; no second live execution is planned.
- A second prepared flow is a recovery option, but cannot resolve a network-wide outage.

## Achievements and evidence boundaries

Paiflow is a visual, non-custodial payment-flow builder on Stellar / Soroban. The InstaAwards sprint ran **September 7–October 4, 2026**. The visual builder and factory already existed; do not present them as newly built during the sprint.

All four deliverables are marked complete in `docs/instawards/README.md`:

1. **Real swaps:** Soroswap testnet router, live quotes, slippage protection and output forwarded to the next payment step.
2. **Developer API:** deployment-scoped tokens, prepare/sign/submit execution and events; caller signs and Paiflow does not hold the caller's key.
3. **Builder usability:** shared inputs in the Swapper panel, consistent errors, numeric editing, keyboard/mobile support; 83 component tests across seven files. Do not claim every panel was migrated.
4. **Validation:** wallet and API execution on one deployment, published walkthrough, integration guide and transaction evidence.

Sources: `docs/instawards/week-1.md` through `week-4.md`, `handoff.md`, `deliverables/` and `metrics.md`. All showcase evidence is **Stellar testnet**; mainnet was outside scope.

September 30 live-database snapshot: 86 unique deployed flows, 23 unique executed swapper flows, 28 deploying wallet addresses and 177 contract executions/events. These are separate from the alpha cohort below. Wallet addresses are not people; do not sum archive/live totals or attribute public activity to external testers or the alpha cohort. The repository reports SOW success targets met independently on archive and live activity bases.

## Alpha baseline and October forecast

Use **`/home/salt/Downloads/paiflow-kpis-october-2026.pdf`**, embedded creation/modification date **October 3, 2026, 06:39:39 HKT**. The Telegram copy and October 2 PNG contain an older, lower forecast; download timestamps do not establish document version order.

| Metric                                          | Baseline | Minimum forecast by October 31 |
| ----------------------------------------------- | -------- | ------------------------------ |
| Users onboarded                                 | 9        | 45+                            |
| Flow deployments                                | 42       | 110+                           |
| Unique flows designed (distinct flows deployed) | 25       | 60+                            |
| Transactions signed                             | 73       | 190+                           |
| Wallets signing (distinct addresses)            | 17       | 45+                            |
| Sandbox tries (browsers opening the builder)    | 8        | 60+                            |

Baseline: nine-person alpha cohort (**one project member, eight external**) as of September 30; sandbox browsers as of October 1. The cohort had seven executed swap flows. The PDF's 17 signing wallets and repository's 15 deploying wallets measure different actions. Forecasts are planned minimums, not achieved or guaranteed results.

## Planned events and roadmap

- **Three hackathons in collaboration with JRU, Web3 Iloilo and FEU Tech**. This user correction supersedes the earlier two-event framing and the forecast PDF's single-event framing; no combined team capacity was supplied. Hackathons are the largest event feature on slide 5.
- Weekly builder sessions after the hackathons.
- Hands-on Paiflow booth at BlockQuest Fiesta PH in Laguna.
- Aklan event at **Northwestern Visayan College** to bring Paiflow to more students through **a booth, a mini hackathon, or both**. The user requested removal of the planning/date label from the deck and notes; no event date was supplied. Smaller feature on slide 5.
- Roadmap: PHP cash-out through a licensed off-ramp partner and USDT/EURC support. These are plans, not shipped achievements. Do not invent event dates or imply planned events have happened.

## Supporting assets

- Published 3:49 technical walkthrough: https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing
- Walkthrough script: `docs/instawards/evidence/d4/walkthrough-script.md` (planned timing differs from published length).
- Unedited 9:44 Freighter recording: https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing
- Swapper before/after: `docs/instawards/evidence/d3/17-swap-panel-before-after.png`.
- September 28 wallet receipt: `750f64c1ac2e2e0085ffcc94aea1f15e2e3d5dcfc961625a92bb0cbf951db903` (10 XLM → 1.0565359 USDC).
- API receipt on the same deployment: `569295336b906aaeb9538c519bd4d5f7020671a945ac39908fe46d2651803ae6`.
