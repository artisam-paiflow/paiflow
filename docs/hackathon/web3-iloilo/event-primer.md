# Paiflow × Web3 Iloilo — Event Primer

Updated October 23, 2026

Build an app that solves a real problem with automated payments through Paiflow. Teams can start building as soon as they receive this document. Use October 25 to finish your integration, demonstrate your app and show how its payment flow works.

## At a glance

| Item                    | Details                                                 |
| ----------------------- | ------------------------------------------------------- |
| Date                    | October 25, 2026                                        |
| Time                    | 9:00 AM–7:00 PM Philippine Time (PHT)                   |
| Event link              | [Google Meet](https://meet.google.com/vpx-yzhb-iyd)     |
| Teams                   | 10 teams of 1–4 people                                  |
| Event building sessions | 9:45 AM–12:00 PM and 1:00–4:00 PM                       |
| Prize pool              | PHP 10,000                                              |
| Network                 | Stellar testnet; testnet funds have no real-money value |

## Preparation and integration timeline

**As soon as you receive this document:** choose a problem, sketch your app and start building. Prepare your wallets, deploy your flow, integrate Paiflow and test payments before the event using the Paiflow Guide. Ask the organisers for access if your team needs it.

**On October 24:** attend the online onboarding at **9:00 AM PHT** via [Google Meet](https://meet.google.com/ney-upkk-svq). Watch a live Paiflow demo and continue building and testing your app’s payment integration.

**On October 25:** join the [hackathon](https://meet.google.com/vpx-yzhb-iyd) at **9:00 AM PHT**. Use the building sessions to finish integration and prepare your pitch. Use your team’s own deployment, verify payouts and keep the deployment ID and transaction hashes for your demo. Pitching starts at **4:00 PM PHT**.

## Event program

All times are in **Philippine Time (PHT)** on **October 25, 2026**.

### Hackathon schedule

| Time             | Activity                            | What happens                                            |
| ---------------- | ----------------------------------- | ------------------------------------------------------- |
| 9:00–9:30 AM     | Registration & Networking           | Check in and meet the participants                      |
| 9:30–9:45 AM     | Opening Remarks                     | Hear the event instructions                             |
| 9:45 AM–12:00 PM | Project Building & MVP Development  | Build your app and work on integration                  |
| 12:00–1:00 PM    | Lunch Break                         | Take a lunch break                                      |
| 1:00–4:00 PM     | Project Building & MVP Development  | Finish integration, test payments and prepare your demo |
| 4:00–5:00 PM     | Project Demo & Pitching             | Teams present their projects and demos                  |
| 5:00–5:45 PM     | Judging & Winners Announcement      | Judges deliberate and announce the winners              |
| 5:45–6:00 PM     | Closing Remarks & Photo Opportunity | Wrap up the event                                       |
| 6:00–7:00 PM     | Dinner with Staffs                  | Staff dinner                                            |

## The challenge

Build for a real user. Explain who pays, why they pay and who receives the money. Your app handles the customer experience; your Paiflow flow handles when money moves and where it goes.

One deployment can serve a business or group and accept payments from multiple customers. The SDK and HTTP API operate existing deployments; they do not create a new deployment for every customer.

| Idea            | What it does                                    | Paiflow pieces     |
| --------------- | ----------------------------------------------- | ------------------ |
| Shared checkout | Split each sale between a shop and a partner    | On Receive → Split |
| Creator tip jar | Share tips among collaborators                  | On Receive → Split |
| Event tickets   | Route ticket payments to a configured recipient | On Receive → Pay   |
| Donation drive  | Share donations among configured beneficiaries  | On Receive → Split |

Use the SDK payment starter as a minimal integration example, then adapt it to your own app. It starts with a fixed 1 XLM payment to a testnet Receive deployment. The Paiflow Guide explains the setup; the SDK and HTTP API references provide detailed integration instructions.

For your demo, explain the problem, show the customer payment experience and show the confirmed payout to the intended recipients. Keep the transaction hash available so the result can be checked.

## Pitching requirements and format

Prepare a **pitch deck**. Each team has **three minutes for the presentation and demo, followed by two minutes for Q&A**.

Follow this order:

1. **Problem:** briefly describe the intended user and their problem. Keep claims specific and proportionate; do not overstate the problem.
2. **Solution:** explain what your app does and how it addresses the problem.
3. **Impact on Stellar:** explain how your app uses the Stellar blockchain and what useful activity or adoption it could bring. Distinguish demonstrated results from future potential.
4. **Paiflow integration:** show your flow and explain its role in the app.
5. **Demo:** show the customer experience, payment and confirmed payout.

Keep the deck concise enough to leave time for the demo within your three minutes. The 10 team slots fit within the **4:00–5:00 PM PHT** pitching session, so have your deck and app ready before your turn and start promptly.

## Prizes

The total prize pool is **PHP 10,000**. Judging and winners announcement take place from **5:00–5:45 PM PHT**.

## Event support and coordination

### Resources and support

| Resource                   | Link                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paiflow app                | [Open the beta app](https://beta.app.paiflow.xyz)                                                                                                                                                                |
| Windows development setup  | [Windows Setup Guide](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/setup-guide.md)                                                                                                     |
| Wallet, flow and app setup | [Paiflow Guide](https://drive.google.com/file/d/1abY-gT2TERr_av3eRPHjc9e8vTfkDnuY/view?usp=sharing)                                                                                                              |
| SDK integration            | [SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) · [Method and type reference](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/reference/README.md) |
| HTTP integration           | [HTTP API README](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md), including OpenAPI and Postman resources                                                                           |
| SDK payment example        | [Hackathon starter](https://github.com/artisam-paiflow/paiflow-hackathon-starter)                                                                                                                                |
| Sample application         | [Campus Snacks source](https://github.com/artisam-paiflow/paiflow-campus-snacks)                                                                                                                                 |
| AI context                 | [Shared developer context](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/hackathon/llms.md)                                                                                                       |

Ask the event organisers for setup help and event coordination, or contact [paiflow+iloilo.hack@artisam.xyz](mailto:paiflow+iloilo.hack@artisam.xyz).

### What to prepare and bring

Prepare a laptop, charger, GitHub account and supported testnet wallet. Follow the Paiflow Guide and starter instructions for Node.js, pnpm, Git and Freighter setup. Arrange internet access for development, wallet signing and transaction checks.

Fund your wallets before testing. Friendbot supplies testnet XLM only; USDC requires its exact trustline and separate testnet funding.

Use Paiflow for your app's core payment flow and use testnet only. Each customer authorises their payment in their own wallet. Keep API tokens and webhook secrets on your server. Never store customer wallet secret keys in your app or include credentials in screenshots or demos. No API or relayer load-testing or spam.
