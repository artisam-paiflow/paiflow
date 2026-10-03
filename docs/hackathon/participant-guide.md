# Paiflow Hackathon — Participant Guide

Sep 30, 2026 · @kryshna

Build an app that moves money for real people in one day, with Paiflow handling the money. No crypto experience needed.

## At a glance

|                   |                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| What              | A one-day, in-person hackathon: build an app that moves crypto, using Paiflow as the money layer |
| Who               | Students; no prior crypto experience assumed                                                     |
| Teams             | 10 teams of 2–5 people                                                                           |
| Build time        | 4 hours: 2 in the morning, 2 in the afternoon                                                    |
| Pitching          | 5 minutes per team                                                                               |
| Prize pool        | PHP 10,000 across five awards                                                                    |
| Network           | Stellar testnet only, on the Paiflow beta app (beta.app.paiflow.xyz). No real money              |
| Date and venue    | To be announced                                                                                  |
| Online onboarding | Before the event; date and platform to be announced                                              |

## Schedule

There are two parts: a short **online onboarding** before the event, and the **in-person day**, which is only building and pitching.

**Online onboarding** (date to be announced). You'll get your team's Paiflow account and wallet, hear the rules, and watch a live demo: build a flow, deploy it, scan the QR, and watch the payout land.

**Event day.** Times are counted from the start time, which will be announced with the date. Doors open 30 minutes before 0:00 for check-in and Wi-Fi.

| Start | Length | Block                 | What happens                                                                     |
| ----- | ------ | --------------------- | -------------------------------------------------------------------------------- |
| 0:00  | 2 h    | Development, part 1   | Build. Mentors walk around to help                                               |
| 2:00  | 1 h    | Lunch + checkpoint    | Coding is optional. Mentors check in with every team; stuck teams get help first |
| 3:00  | 2 h    | Development, part 2   | Keep building                                                                    |
| 4:30  | 30 min | Submission            | Submit before 5:00. Judges check your deployment as you submit                   |
| 5:00  | 1 h    | Pitching              | 10 teams, 5 minutes each, in a random order drawn at 5:00                        |
| 6:00  | 30 min | Deliberation + awards |                                                                                  |

## The challenge

**Build an app that moves money for real people, with Paiflow handling the money.** The theme is open; the ideas below are only there to get you started.

Paiflow turns a flow you draw into deployed Stellar contracts. Your app decides _who_ pays and _why_. Your Paiflow flow decides _when_ money moves and _where_ it goes.

**The examples below are sparks, not a menu.** Start from a problem you or people around you actually have, then pick the Paiflow pieces that fit it. Use the table to see how the building blocks combine, not to choose a project from it.

| Idea                       | What it does                                                                                            | Paiflow pieces                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Barkada bill splitter      | One person pays the trip fund; it splits automatically to whoever fronted the costs                     | `on_receive` + `split`, QR trigger page   |
| Org dues and event tickets | Students pay dues or a ticket by scanning a QR; the money splits between the org treasury and the venue | `on_receive` + `split`, embed + live feed |
| Creator collab tip jar     | Tips to a shared project split between collaborators by agreed percentages                              | `on_receive` + `split`                    |
| Sari-sari store checkout   | Customer scans and pays; the supplier's share goes out right away                                       | `on_receive` + `split` or `pay`           |
| Digital baon               | A parent sets a weekly allowance that pays out on schedule                                              | `on_schedule` + `pay`                     |
| Tutor or club subscription | Members approve once, then get charged each period                                                      | `subscription` + allowance page           |
| Freelance milestone escrow | Client funds up front; payment is released only after N-of-M approval                                   | `condition` (`multisig`) + `pay`          |
| Rewards from a Web2 app    | A quiz, fitness or study app pays users when they hit a goal, with no wallet on the user's side         | `web2_webhook` + `/api/v1` execute        |
| Transparent donation drive | Donations split to beneficiaries, with a public live feed as proof                                      | `on_receive` + `split`, embed + live feed |

Strong projects share three traits: a real user with a real problem, a flow whose shape fits that problem, and a demo where money visibly moves.

**Your team plays the customers.** There are no outside users on the day. Each customer is a testnet wallet that a team member controls, and it signs its own payment in the browser: your app asks Paiflow's `/api/v1` to prepare the payment, the wallet signs it, and your app submits it. The money and transactions are real (on testnet); only the people are pretend. Your app never holds a customer's secret key.

**One deployment belongs to one business or group.** Your flow is deployed from your team's Paiflow account, and your app drives it through the API. Paiflow can't yet give each of your app's users their own copy of the flow, so design around one deployment for the store, org or group your app serves. If your idea needs a copy per user, say so in your pitch: it's how you'd reach real users later.

## Before the event

You only have 4 hours to build, so set up before you arrive. Planning your idea, talking to possible users and sketching designs beforehand is encouraged; code comes on the day.

- [ ] Register your team and give consent to feature your project and to be photographed (on the registration form)
- [ ] Attend the online onboarding and log in to your team's Paiflow account
- [ ] Install a Stellar wallet browser extension on at least one laptop per team
- [ ] Install Node.js and git, and have a GitHub account
- [ ] Set up an AI assistant of your choice
- [ ] Pick an idea and the real person it helps
- [ ] Bring a laptop, a charger, and an HDMI adapter if your laptop needs one

## What you get

The starter kit is meant to get your team from zero to a first payout in under 30 minutes.

| Item                       | What it is                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Paiflow account            | One testnet account per team, handed out at the online onboarding                                                                         |
| Pre-funded testnet wallets | Three wallets per team, each holding testnet XLM and 1,000 testnet USDC, so no faucet setup. You're encouraged to create more of your own |
| Template repo              | A small web app already wired to an embedded trigger page, the live event feed and an `/api/v1` execute call; swap in your own idea       |
| AI context pack            | One file describing Paiflow's blocks, hosted pages and `/api/v1` API, with example flows, to paste into your AI assistant                 |
| Mentors                    | Paiflow team members on the floor during development and at the lunch checkpoint                                                          |

**The wallets we give you are for testnet only.** The organisers create them, so the organisers also hold copies of their secret keys. Never send real (mainnet) funds to them, and never import them into a wallet you use for real money: anyone with the key can take what's in it.

## Rules

1. **The core money flow runs through Paiflow.** The transfer that makes your app work must be a Paiflow deployment. Incidental direct transfers (e.g. topping up a test wallet) are fine.
2. **Testnet only.** No mainnet deployments and no real funds. Everything runs on the beta app, beta.app.paiflow.xyz.
3. **AI tools are allowed and encouraged.** Use any AI assistant; the AI context pack is there for this.
4. **Plan before, build on the day.** Ideas, user research and designs may be prepared beforehand. All code and Paiflow deployments are made on the day. Boilerplate, open-source libraries and the Paiflow template repo are allowed.
5. **Coding over lunch is optional.** It isn't counted as extra time and isn't penalized.
6. **Use the account you're given.** Use your team's Paiflow account. Don't create extra Paiflow accounts or use sandbox sessions for your final demo. Extra testnet wallets are fine and encouraged.
7. **Be kind to shared infrastructure.** No load testing or spamming the Paiflow API or relayer. Rate limits apply.
8. **You own your project.** By entering, you let Paiflow feature your project's name, description, demo, screenshots and event photos on its homepage and socials.
9. **Follow the code of conduct** below.
10. **Organizers decide disputes.** Their ruling is final.

The beta app collects usage analytics (PostHog) to improve Paiflow; the registration form has the details.

## Qualifying and submitting

**To be ranked, your team needs a confirmed Paiflow deployment and at least one on-chain payout from it.** Teams that miss this still pitch, but aren't ranked or eligible for prizes.

Submit by **5:00** on the schedule:

- [ ] Team name and members
- [ ] One-line description of the app
- [ ] Paiflow deployment ID(s) your app uses
- [ ] At least one payout tx hash from that deployment
- [ ] Screenshot of your flow's English preview
- [ ] Link to your code repository
- [ ] Live URL, if you have one
- [ ] The team member who would receive a prize, and their QR Ph code

Judges check your deployment ID and tx hash on-chain as submissions come in, so submit early rather than at 4:59.

## Judging

Each judge scores qualifying teams out of 100. Integration rewards a flow that fits your problem, not the number of blocks you used.

| Criterion                  | What judges look at       | Points | A top score looks like                                                                                                               |
| -------------------------- | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Creativity (30)            | Originality of the idea   | 15     | A problem or angle judges haven't seen before                                                                                        |
| Creativity (30)            | Product experience        | 15     | Paying or getting paid feels natural; the crypto part is invisible or delightful                                                     |
| Integration (40)           | Flow fits the problem     | 15     | The trigger, conditions and actions match how money should really move; nothing is bolted on                                         |
| Integration (40)           | App uses Paiflow surfaces | 15     | The app is built around Paiflow's pages or API (QR trigger, embed, live feed, allowance page, `/api/v1`), not a link off to the side |
| Integration (40)           | Works end to end on stage | 10     | Money moves live during the demo and the result is visible                                                                           |
| Real-world usefulness (30) | Real user, real problem   | 15     | A specific person with a clear pain; ideally one you've talked to                                                                    |
| Real-world usefulness (30) | Could be used tomorrow    | 15     | A plausible path to real users in the Philippines; cost, trust and onboarding thought through                                        |

Your final score is the average across judges. Ties go to the higher Integration score.

## Pitching

Each team gets **5 minutes: a 3-minute pitch with a live demo, then 2 minutes of judges' Q&A.**

- Your demo must show money moving: trigger the flow, then show the payout (the live feed, the recipient's balance, or the tx on an explorer).
- The timer is strict. At 3:00 your pitch ends and Q&A begins.
- Pitch order is drawn at random at the end of development.
- Set up your laptop while the team before you is in Q&A.
- A screen recording of your demo is allowed as a backup if the live run fails, but a live demo scores higher.

## Prizes

PHP 10,000 in total, across five awards. Prizes are paid by QR Ph to the team member you name on your submission.

| Award            | Prize (PHP) | How it's decided                                                                                                      |
| ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| 1st place        | 4,000       | Highest score                                                                                                         |
| 2nd place        | 2,500       | Second-highest score                                                                                                  |
| 3rd place        | 1,500       | Third-highest score                                                                                                   |
| Best Integration | 1,000       | Highest Integration score among teams that didn't place                                                               |
| Paiflow Pick     | 1,000       | The Paiflow team's pick of the project it most wants to feature and support, among qualifying teams that didn't place |

Every team gets a certificate, and winning projects are featured on the Paiflow homepage and socials.

## Code of conduct

We want a room where anyone can ask a basic question.

- Be respectful to everyone: participants, mentors, judges and venue staff. No harassment, discrimination or intimidation of any kind.
- Help, don't mock. There are no stupid questions about crypto.
- Respect other teams' work. Don't copy another team's code, flows or pitch, and don't interfere with their deployments or wallets.
- Keep secrets secret. Don't share your team's Paiflow login, API tokens or wallet secret keys, and never commit them to a public repo.
- Photos only with consent. Ask before photographing or recording someone.
- Report problems to the organizer on duty, named at the start of the day. Reports are handled privately.
- Organizers may warn, disqualify from prizes, or ask anyone who breaks this code to leave.

## Tips for the day

- **Deploy early.** Aim for a first payout before the lunch checkpoint, then build your app around it.
- **Scheduled flows take time.** Payroll, subscription and allowance flows pay out when Paiflow's scheduler runs, not instantly. Get your first payout well before 4:30.
- **The live feed can lag by up to a minute.** Keep the tx open on a Stellar explorer during your demo as a backup.
- **Log in carefully.** Five wrong passwords lock your team's account for 15 minutes. If it happens, find an organizer.
- **Record a backup demo** once your flow works, in case the live run fails on stage.
- **Ask mentors early.** Being stuck for 20 minutes costs more than a question.
