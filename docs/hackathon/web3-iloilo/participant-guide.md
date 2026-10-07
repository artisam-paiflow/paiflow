# Paiflow × Web3 Iloilo Hackathon Mechanics

Updated Oct 6, 2026

Build an app that solves a real problem with automated payments. Choose your idea now. After onboarding on October 16, build your app’s screens and features that don’t involve payments. Add Paiflow payments when the event’s integration window opens.

## At a glance

|                        |                                                                          |
| ---------------------- | ------------------------------------------------------------------------ |
| What                   | One-day, online hackathon to build apps that move crypto through Paiflow |
| Who                    | Web3 Iloilo                                                              |
| Teams                  | 10 teams of 1–4 people (open to discussion)                              |
| Venue                  | Online                                                                   |
| Event starts           | October 18, 2026; time TBA                                               |
| Integration time       | TBD                                                                      |
| Prize pool             | PHP 10,000 across five awards                                            |
| Network                | Stellar testnet                                                          |
| Onboarding / pre-event | October 16, 2026; time TBA                                               |
| Registration closes    | TBA                                                                      |

## Registration and resources

- **Registration form:** TBA.
- **Starter repository:** [GitHub](https://github.com/artisam-paiflow/paiflow-hackathon-starter).
- **AI context pack:** [Web3 Iloilo context pack](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms-web3-iloilo.md). Use this context pack for preparation and integration instructions.
- **Sample project: Campus Snacks**
  - [GitHub source](https://github.com/artisam-paiflow/paiflow-campus-snacks)
  - [Live app](https://campus-snacks.up.railway.app)
- **Support contact:** [paiflow+iloilo.hack@artisam.xyz](mailto:paiflow+iloilo.hack@artisam.xyz).

Team capacity and size are open to discussion with Web3 Iloilo. Solo teams are welcome, but teams are encouraged to have at least two members. If more than 10 teams apply, we will coordinate with Web3 Iloilo to determine the best way forward.

**_Resource content may be updated without prior notice._**

**Online sessions:** Both October 16 onboarding and the October 18 hackathon take place online. Paiflow and Web3 Iloilo will share the meeting links through the announced event channel.

## Preparation and integration timeline

**Starting now:** choose a problem, talk to potential users and sketch your app.

**Online onboarding / pre-event: October 16, 2026; time and meeting link TBA.** Hear the rules and watch a live demo: build, deploy, scan the QR and see the payout. Paiflow and Web3 Iloilo will share the meeting link through the announced event channel.

**After October 16 onboarding:** start building your app’s screens and features that don’t involve payments. You may use the supplied starter, but keep its payment features and live feed disabled until the announced integration start.

**October 18, at the announced integration start:** receive your team's Paiflow account credentials and begin Paiflow integration. Flow deployment, connecting your app to Paiflow APIs and live payment testing must wait until the announced integration start. Preparing a wallet, adding its trustline and obtaining testnet funds are allowed beforehand.

**Schedule: TBD.** All times are in Philippine Time.

## The challenge

The theme is open. Start with a problem you or people around you have, then choose the Paiflow blocks that fit. These examples show how blocks combine and can inspire your own idea.

Paiflow deploys a flow you draw as Stellar contracts. Your app decides _who_ pays and _why_; your flow decides _when_ money moves and _where_ it goes.

| Idea                       | What it does                                                                                               | Paiflow pieces                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Barkada bill splitter      | A friend pays their share of a trip. The money automatically goes to friends who paid the group's expenses | `on_receive` + `split`, QR trigger page                         |
| Org dues and event tickets | QR payments for dues or tickets split between the org treasury and venue                                   | `on_receive` + `split`, embed + live feed                       |
| Creator collab tip jar     | Shared-project tips split between collaborators at agreed percentages                                      | `on_receive` + `split`                                          |
| Sari-sari store checkout   | A customer scans and pays; the supplier's share is sent immediately                                        | `on_receive` + `split` or `pay`                                 |
| Digital baon               | A parent sets up scheduled weekly allowance payments                                                       | `on_schedule` + `pay`                                           |
| Tutor or club subscription | One configured member approves an allowance for recurring charges                                          | `subscription` + allowance page                                 |
| Freelance deadline escrow  | Client pays up front; acceptance before the deadline pays the freelancer, otherwise the client is refunded | `on_receive` + `condition` (`time_before`) + two `pay` branches |
| Rewards from a Web2 app    | A pre-funded pool pays a configured recipient when the app reports a completed goal                        | `web2_webhook` + authenticated callback + `pay` or `split`      |
| Transparent donation drive | Donations split among beneficiaries, with a public feed showing payouts                                    | `on_receive` + `split`, embed + live feed                       |

Strong projects have a real user, a flow that fits their problem, and a demo with visible payouts.

For setup instructions and example payment flows, see the [Web3 Iloilo AI context pack](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms-web3-iloilo.md). Confirm feature availability with the support contact before choosing an idea.

Testnet funds have no real-money value. Never store wallet secret keys in your app.

Set up Paiflow once for the business, group or branch your app serves. For example, [Campus Snacks](https://campus-snacks.up.railway.app) represents one branch of a snack shop. Each customer pays separately, but every payment uses the same setup: 90% goes to the shop and 10% to the student organisation. You don’t need a new setup for each customer.

If your idea requires a separate payment setup for every customer, explain that as a future feature in your pitch.

## Before the event

Choose your idea now. After October 16 onboarding, build your app’s screens and features that don’t involve payments. Integrate your app with Paiflow during the announced integration window on October 18.

- [ ] Register once the registration form link and deadline are announced
- [ ] Attend online onboarding / pre-event on October 16, 2026, at the announced time; Paiflow and Web3 Iloilo will share the meeting link. Share the instructions with your team
- [ ] Join the online hackathon on October 18, 2026, at the announced start time using the meeting link provided
- [ ] Install [Freighter](https://www.freighter.app/) on at least one team laptop and set it to testnet
- [ ] Install Node.js 22, pnpm 10 and git, and have a GitHub account
- [ ] Arrange a reliable internet connection for both online sessions, development and payment testing
- [ ] Pick an idea

**Internet connection:** Participants must arrange their own reliable internet connection for both online sessions, development and payment testing.

**After October 16 onboarding, before integration starts:**

- [ ] Install and run the supplied starter on your laptop
- [ ] Build your app’s screens and features that don’t involve payments
- [ ] Prepare dedicated testnet wallets for your customer and payout recipients
- [ ] If using USDC, enable each recipient wallet to receive the exact testnet USDC asset by adding its trustline; follow the AI context pack’s instructions
- [ ] Obtain testnet XLM for wallet setup and transaction fees, and testnet USDC for payments if needed

**Testnet funding:**

1. In Freighter, select **Testnet** and fund each new wallet with testnet XLM through Friendbot so the account exists and can cover reserves and fees. See [Stellar's testnet setup guide](https://developers.stellar.org/docs/build/guides/freighter/connect-testnet). Friendbot supplies XLM, not USDC.
2. If using USDC, add a trustline in each customer and recipient wallet for code `USDC` and issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. Have each wallet sign its own trustline transaction. A trustline to another issuer's USDC will not work, and adding one does not add funds.
3. Open [Circle's testnet faucet](https://faucet.circle.com/), select **USDC** and **Stellar Testnet**, then enter the customer's public wallet address (`G…`). Confirm the USDC balance before testing payments. Repeat for any wallet that will fund a flow, and choose test amounts that fit the available balance.

For more setup instructions, see the [Web3 Iloilo AI context pack](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms-web3-iloilo.md). If you need help with funding, contact [support](mailto:paiflow+iloilo.hack@artisam.xyz). Availability of online wallet support and ready-to-use fallback wallets is TBA with the organisers.

Organiser-provided wallets are for testnet only. Organisers retain copies of their keys. Never use these wallets for real funds or import their keys into a wallet you use for real money.

## Your first payout during integration

Get one confirmed payout working before polishing your app.

1. Receive your Paiflow credentials and log in to your team's account.
2. Check that all wallets have testnet XLM. For USDC payments, the customer also needs USDC and recipients must be set up to receive the exact asset.
3. Draw your payment flow in Paiflow using your team’s recipient wallets. Replace default Alice/Bob/Charlie addresses; they are placeholders.
4. Deploy the flow, approve it in your wallet and wait for **CONFIRMED**.
5. Connect your app to that deployment using the AI context pack’s setup instructions. Create an API token under **API access** and keep it on your app’s server. Never put it in browser code or store wallet secret keys in your app.
6. Trigger a test payout using the instructions for your chosen flow in the AI context pack. For wallet-signed payments, approve it in Freighter and wait for **SUCCESS**. A pending or uncertain result is not a confirmed failure: check its status and, for a wallet-signed payment, retry the same signed transaction rather than creating another payment.
7. Check that the recipients received the payout, then save its transaction hash for submission. You can verify it in the payment feed or a Stellar explorer.

Use your team’s deployment for your qualifying payout. Payments through the starter’s shared demo do not qualify; shared-demo access is also limited on shared Wi-Fi.

## Rules

1. **Use Paiflow for the core money flow.** Your app's essential transfer must run through a Paiflow deployment.
2. **Testnet only.** No mainnet deployments or real funds.
3. **AI tools are encouraged.** Use any AI assistant; an AI context pack is provided.
4. **Prepare early; integrate Paiflow during the announced window.** Choose your idea now. After October 16 onboarding, build your app’s screens and features that don’t involve payments. You may use boilerplate, open-source libraries and the supplied starter; keep its payment features and live feed disabled until the announced integration start. Deploying flows, connecting your app to Paiflow and testing payments must wait until the announced integration start. Wallet preparation and testnet funding are allowed beforehand.
5. **Respect shared infrastructure.** No load testing or spamming the Paiflow API or relayer. Rate limits apply.
6. **Organisers decide disputes.** Their ruling is final.

The beta app collects usage analytics (PostHog) to improve Paiflow.

## Qualifying and submitting

**To qualify, you need a confirmed Paiflow deployment and at least one on-chain payout from it.** Otherwise, you may still pitch but won't be ranked or eligible for prizes.

**Submission form:** link coming soon. Submissions are on October 18, 2026; the deadline time is TBA.

Prepare your team name and contact, app description, repository and live app links, confirmed deployment ID, payout transaction hash or explorer link, and demo link if using a recording. The final form will specify the required fields.

## Judging

Each judge scores qualifying teams out of 100. Integration rewards fit to your problem over block count.

| Criterion                  | What judges look at     | Points | A top score looks like                                                                                  |
| -------------------------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Creativity (30)            | Originality             | 15     | A problem or angle judges haven't seen before                                                           |
|                            | Product experience      | 15     | Paying or getting paid feels natural; the crypto part is invisible or delightful                        |
| Integration (40)           | Flow fits the problem   | 15     | Triggers, conditions and actions fit how money should move; nothing feels bolted on                     |
|                            | Paiflow integration     | 15     | Paiflow pages or APIs are central to the app: QR trigger, embed, live feed, allowance page or `/api/v1` |
|                            | Works end to end        | 10     | A live demo of your app's payment flow with a verifiable on-chain payout                                |
| Real-world usefulness (30) | Real user, real problem | 15     | A specific user with a clear problem, ideally someone you've spoken to                                  |
|                            | Could be used tomorrow  | 15     | A plausible path to users in the Philippines, accounting for cost, trust and onboarding                 |

Your final score and each criterion score are the averages across judges. Compare scores before rounding for display.

Under **Works end to end (10 points)**, a live demo can earn up to **10 points**; a recorded demo can earn up to **7 points**. Either must show your team's actual app, Paiflow deployment and a verifiable payout from it. The demo format affects only this criterion; all other criteria keep the same maximum points. The qualifying on-chain payout remains mandatory.

## Pitching

Each team gets **5 minutes: 3 for a pitch and demo, then 2 for judges' Q&A.**

- Pitch and demo your app's payment flow live or in a screen recording, and show the payout in the live feed, recipient balance or explorer transaction.
- At the three-minute mark, your pitch ends and Q&A begins. The timer is strict.
- Pitch order is drawn at random when development ends.
- Prepare your screen share during the previous team's Q&A.
- You may use a screen recording, including if your live demo fails. If the recording provides the successful demonstration, the recorded-demo maximum of 7 points applies to **Works end to end**.

## Prizes

PHP 10,000 across five awards, for qualifying teams only. Prizes go by QR Ph to the member named in your submission.

| Award                      | Prize (PHP) | How it's decided                                         |
| -------------------------- | ----------- | -------------------------------------------------------- |
| 1st place                  | 4,000       | Highest score                                            |
| 2nd place                  | 2,500       | Second-highest score                                     |
| 3rd place                  | 1,500       | Third-highest score                                      |
| Best Integration           | 1,000       | Highest Integration score among eligible teams           |
| Best Real-World Usefulness | 1,000       | Highest Real-world usefulness score among eligible teams |

**If fewer than three teams qualify:** award only the available places at their published amounts. With one qualifying team, award first place only; with two, award first and second. Both special awards are still awarded when at least one team qualifies. Vacant placing prizes remain unawarded, and unused prize funds are not redistributed. If no team qualifies, no prizes are awarded.

Winning projects are featured on the Paiflow homepage and socials.
