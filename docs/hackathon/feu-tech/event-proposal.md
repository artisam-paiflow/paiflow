# Paiflow × FEU Tech Hackathon — Event Proposal

Updated Oct 9, 2026

**Planning draft for the FEU Tech student organisation.** This proposal provides an overview for discussion and coordination. It is not the final public document for participants. Detailed participant instructions, including what to bring and prepare, will be provided in a separate participant brief.

The Paiflow event at FEU Tech is a full-day hackathon from 8:00 AM to 5:00 PM PHT. Teams build an app that solves a real problem with automated payments through Paiflow.

## At a glance

| Item              | Details                                           |
| ----------------- | ------------------------------------------------- |
| When and where    | October 28, 2026 · FEU Tech · 8:00 AM–5:00 PM PHT |
| Format            | Full-day, in-person hackathon                     |
| Teams             | 10 teams of 1–4 people                            |
| Online onboarding | Date and time TBD                                 |
| Prize pool        | PHP 10,000 across five awards                     |
| Network           | Stellar testnet                                   |

## Event program

### Online onboarding

**Date and time TBD.** Hear the rules and watch a live Paiflow demo: build, deploy, scan the QR and see the payout. The meeting link will be shared by the organisers.

Participants may build their app, deploy flows, integrate Paiflow and test payments before the event once their team credentials are available. Ask organisers for credentials in advance; onboarding covers setup and questions.

Participants may freely explore the sandbox at [beta.paiflow.xyz](https://beta.app.paiflow.xyz) before the event, including creating practice flows and testing payments with the features available there. A video tutorial is also available there. Sandbox deployments do not provide API access for connecting your own app.

You may deploy your team's flow and connect the app before the event. Produce a confirmed on-chain payout from your team's deployment during the event development session for qualification. Sandbox and shared-demo payouts do not qualify.

All event-day times below are in Philippine Time (PHT).

### Hackathon schedule

**Venue: FEU Tech. Room TBD.**

| Time             | Activity              | What happens                                                                                                 |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| 8:00–8:30 AM     | Registration          | Check in and get your team ready                                                                             |
| 8:30–9:00 AM     | Opening and briefing  | Review the challenge, rules, schedule and submission requirements                                            |
| 9:00 AM–12:00 PM | Build and integration | Finish integration and verify an event-day payout                                                            |
| 12:00–1:00 PM    | Lunch break           | Optional coding; check your deployment and payout evidence                                                   |
| 1:00–3:00 PM     | Build and integration | Complete integration and prepare your demo                                                                   |
| 2:30–3:00 PM     | Submission            | During the final 30 minutes of development, submit by 3:00 PM with your deployment ID and payout transaction |
| 3:00–4:00 PM     | Pitching              | 10 teams × 5 minutes; random order drawn at 3:00 PM                                                          |
| 4:00–4:30 PM     | Deliberations         | Judges deliberate                                                                                            |
| 4:30–5:00 PM     | Closing and awards    | Announce prize winners and deliver closing remarks                                                           |

## Preparation and integration timeline

**Starting now:** choose a problem, talk to potential users and sketch your app.

**Before the event:** build your app and integrate Paiflow. Use the starter in team mode when your deployment and token are ready; test payments and the live feed are allowed beforehand.

**Event day, 9:00 AM PHT:** finish your app and integration, confirm an event-day payout and prepare the demo. Deployment and app integration may be completed beforehand.

**Event development session:** 9:00 AM–3:00 PM PHT, with lunch from 12:00–1:00 PM. Early integration is allowed. Submit by **3:00 PM PHT**.

## The challenge

Teams must configure recipients and required values before deployment. Mutable dev-mode flows and per-payment recipient APIs have been removed (#1138); use standard flows with configured recipients.

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

For technical setup and example payment flows, see the [Paiflow developer context guide](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms.md). Follow this event proposal and the organisers’ instructions for preparation and integration timing. Confirm feature availability with the event support team before choosing an idea.

**Support contact:** TBD.

Testnet funds have no real-money value. Never store wallet secret keys in your app.

Set up Paiflow once for the business, group or branch your app serves. For example, [Campus Snacks](https://campus-snacks.up.railway.app) represents one branch of a snack shop. Each customer pays separately, but every payment uses the same setup: 90% goes to the shop and 10% to the student organisation. You don’t need a new setup for each customer.

If your idea requires a separate payment setup for every customer, explain that as a future feature in your pitch.

## Prizes

**Qualification:** your team needs a confirmed Paiflow deployment and at least one verifiable payout from it during the event development session. The deployment and app integration may be prepared beforehand. Sandbox and shared-demo payouts do not count.

**Scoring:** Creativity 30%, Integration 40%, Real-world usefulness 30%.

**Pitch:** each team gets five minutes: three minutes for the pitch and demo, followed by two minutes of judges' Q&A.

PHP 10,000 across five awards, for qualifying teams only.

| Award                      | Prize (PHP) | How it's decided                                         |
| -------------------------- | ----------- | -------------------------------------------------------- |
| 1st place                  | 4,000       | Highest score                                            |
| 2nd place                  | 2,500       | Second-highest score                                     |
| 3rd place                  | 1,500       | Third-highest score                                      |
| Best Integration           | 1,000       | Highest Integration score among eligible teams           |
| Best Real-World Usefulness | 1,000       | Highest Real-world usefulness score among eligible teams |

## Event support and coordination

### Lunch and responsibilities

Paiflow will provide free lunch for up to **40 participants and 10 organisers**, along with the prize pool, developer support and hackathon mechanics.

The FEU Tech student organisation will handle event logistics, including the venue, screen projection and a sound system if needed.

### Planning together

The student organisation is welcome to discuss and suggest changes to any part of the event, including the program, format and mechanics.

If additional expenses are needed, please submit a **budget proposal document as soon as possible**, before committing to those expenses. Include the purpose of each expense, estimated cost and total amount requested. This gives Paiflow time to review the proposal early and approve it or request revisions as needed.
