# Paiflow Hackathon — Event Plan

Sep 29, 2026 · @kryshna

## Overview

A one-day, in-person hackathon where 10 teams of students build apps that move crypto, with Paiflow as the money layer. The main output is a set of showcase projects Paiflow can feature afterwards.

| Item       | Decision                                                     |
| ---------- | ------------------------------------------------------------ |
| Goal       | Build an application that moves crypto                       |
| Audience   | Students; no prior crypto experience assumed                 |
| Format     | In person                                                    |
| Build time | 4 hours: 2 in the morning, 2 in the afternoon                |
| Teams      | 10                                                           |
| Team size  | 2–5 people                                                   |
| Pitching   | 1 hour, 5 minutes per team                                   |
| Prize pool | PHP 10,000                                                   |
| Network    | Stellar testnet only, on the beta app (beta.app.paiflow.xyz) |
| Organizer  | Paiflow, no co-sponsor                                       |

## Schedule

The in-person day is only development and pitching, about 6.5 hours in total; onboarding (rules, accounts, the Paiflow demo) happens at a separate online event beforehand. Times are offsets from the start, since the date and start time aren't set yet.

| Start | Length                         | Block                     | Notes                                                                              |
| ----- | ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------- |
| 0:00  | 2 h                            | Development, part 1       | Mentors circulate                                                                  |
| 2:00  | 1 h                            | Lunch + checkpoint        | Coding optional. Mentors check each team: deployed yet? Stuck teams get help first |
| 3:00  | 2 h                            | Development, part 2       | Heaviest relayer load in the last 30 min                                           |
| 4:30  | 30 min (last 30 min of part 2) | Submission + verification | Submit by 5:00; judges check deployment IDs and tx hashes as submissions come in   |
| 5:00  | 1 h                            | Pitching                  | 10 teams × 5 min                                                                   |
| 6:00  | 30 min                         | Deliberation + awards     |                                                                                    |

## The challenge

**Build an app that moves money for real people, with Paiflow handling the money.** The theme is open. The ideas below are there to get teams started, not to limit them.

Paiflow turns a drawn flow into deployed Stellar contracts. A team's app decides _who_ pays and _why_. The Paiflow flow decides _when_ money moves and _where_ it goes.

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

## Rules

1. **The core money flow runs through Paiflow.** The transfer that makes the app work must be a Paiflow deployment. Incidental direct transfers (e.g. topping up a test wallet) are fine.
2. **Testnet only.** No mainnet deployments and no real funds. Everything runs on the beta app, beta.app.paiflow.xyz.
3. **AI tools are allowed and encouraged.** Teams may use any AI assistant; the Paiflow AI context pack is provided for this.
4. **Plan before, build on the day.** Teams may plan ideas, user research and designs before the event. All code and Paiflow deployments are made on the day. Boilerplate, open-source libraries and the Paiflow template repo are allowed.
5. **Coding over lunch is optional.** It isn't counted as extra time and isn't penalized.
6. **Use the account you're given.** Each team uses its pre-made Paiflow account. Don't create extra Paiflow accounts or use sandbox sessions for your final demo. Extra testnet wallets are fine and encouraged.
7. **Be kind to shared infrastructure.** No load testing or spamming the Paiflow API or relayer. Rate limits apply.
8. **Teams own their projects.** By entering, teams let Paiflow feature the project's name, description, demo, screenshots and event photos on its homepage and socials. The registration form asks for this consent, and for photo consent from each member.
9. **Follow the code of conduct** below.
10. **Organizers decide disputes.** Their ruling is final.

## Code of conduct (proposed)

The event is for students, many new to crypto, so the bar is a room where anyone can ask a basic question.

- Be respectful to everyone: participants, mentors, judges and venue staff. No harassment, discrimination or intimidation of any kind.
- Help, don't mock. There are no stupid questions about crypto.
- Respect other teams' work. Don't copy another team's code, flows or pitch, and don't interfere with their deployments or wallets.
- Keep secrets secret. Don't share your team's Paiflow login, API tokens or wallet secret keys, and never paste them into public repos.
- Photos only with consent. Ask before photographing or recording someone who hasn't given photo consent.
- Report problems to the organizer on duty, named at the start of the day. Reports are handled privately.
- Organizers may warn, disqualify from prizes, or ask anyone who breaks this code to leave.

## Qualification gate and submission

**A team is scored only if it has a confirmed Paiflow deployment and at least one on-chain payout from it.** That keeps slideware out of the running and makes the integration score checkable. Teams that miss the gate still pitch, but aren't ranked.

Submit by the end of development part 2 (5:00 on the schedule):

- [ ] Team name and members
- [ ] One-line description of the app
- [ ] Paiflow deployment ID(s) used by the app
- [ ] At least one payout tx hash from that deployment
- [ ] Screenshot of the flow's English preview
- [ ] Link to the code repository
- [ ] Live URL, if there is one
- [ ] The team member who receives any prize, and their QR Ph code

Judges check each deployment ID and tx hash on-chain as submissions come in during the last 30 minutes of development, so all checks are done before pitching starts at 5:00.

## Judging rubric

Each judge scores teams that passed the gate out of 100, split 30 / 40 / 30 across the three criteria. Integration rewards a flow that fits the problem, not the number of blocks used.

| Criterion                  | Sub-criterion             | Points | A top score looks like                                                                                                               |
| -------------------------- | ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Creativity (30)            | Originality of the idea   | 15     | A problem or angle judges haven't seen before                                                                                        |
| Creativity (30)            | Product experience        | 15     | Paying or getting paid feels natural; the crypto part is invisible or delightful                                                     |
| Integration (40)           | Flow fits the problem     | 15     | The trigger, conditions and actions match how money should really move; nothing is bolted on                                         |
| Integration (40)           | App uses Paiflow surfaces | 15     | The app is built around Paiflow's pages or API (QR trigger, embed, live feed, allowance page, `/api/v1`), not a link off to the side |
| Integration (40)           | Works end to end on stage | 10     | Money moves live during the demo and the result is visible                                                                           |
| Real-world usefulness (30) | Real user, real problem   | 15     | A specific person with a clear pain; ideally one the team has talked to                                                              |
| Real-world usefulness (30) | Could be used tomorrow    | 15     | Plausible path to real users in the Philippines; cost, trust and onboarding thought through                                          |

The final score is the average across judges. Ties go to the higher Integration score.

## Pitching format

Each team gets **5 minutes: a 3-minute pitch with a live demo, then 2 minutes of judges' Q&A.** Ten slots take 50 minutes, leaving 10 minutes of slack in the hour for handovers.

- The demo must show money moving: trigger the flow, then show the payout (the live feed, the recipient's balance, or the tx on an explorer).
- The timer is strict. At 3:00 the pitch ends and Q&A begins.
- Pitch order is drawn at random at the end of development, before pitching starts.
- Teams set up their laptop while the previous team is in Q&A.
- Keep a backup: a screen recording of the demo is allowed if the live run fails, but live counts for more under "Works end to end on stage".

## Prizes

The PHP 10,000 pool covers three placings and two special awards, so five of the ten teams can win something.

| Award                              | Prize (PHP) | Decided by                                                                                                                                 |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1st place                          | 4,000       | Highest rubric score                                                                                                                       |
| 2nd place                          | 2,500       | Second-highest rubric score                                                                                                                |
| 3rd place                          | 1,500       | Third-highest rubric score                                                                                                                 |
| Best Integration                   | 1,000       | Highest Integration score among teams not placed                                                                                           |
| Paiflow Pick (Most Likely to Ship) | 1,000       | Paiflow team's pick of the project it most wants to feature and support after the event, among teams that passed the gate and didn't place |
| **Total**                          | **10,000**  |                                                                                                                                            |

Paiflow Pick rewards the event's main goal: projects Paiflow can feature afterwards. Limiting it to teams that didn't place keeps it from going to 1st place too, since Paiflow staff may judge. The winner also gets a feature on the Paiflow homepage and mentoring after the event.

Cash prizes are paid by QR Ph to one member each winning team names on its submission.

Non-cash extras worth adding at little cost: certificates for every team, Paiflow swag, and a feature of the winning projects on the Paiflow homepage and socials.

## What we provide

With only 4 hours to build, the starter kit should get a team from zero to a first payout in under 30 minutes.

| Item                           | What it contains                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-made Paiflow account       | One testnet account per team, handed out at the online onboarding                                                                                                                                                                                                |
| Pre-funded testnet wallets     | Three organiser-made wallets per team, each holding testnet XLM and 1,000 testnet USDC with the trustline set, so no faucet setup on the day. Teams use them to play their app's customers and may create more. Testnet only: organisers hold copies of the keys |
| Template repo                  | A small web app already wired to an embedded trigger page, the live event feed, and an `/api/v1` execute call; teams swap in their own idea                                                                                                                      |
| AI context pack                | One file describing Paiflow's blocks, hosted pages and `/api/v1` API, with example flows, for teams to paste into their AI assistant                                                                                                                             |
| Onboarding demo (online event) | Live walkthrough: build a flow, deploy it, scan the QR, watch the payout land in the feed                                                                                                                                                                        |
| Mentors on the floor           | Paiflow team members answering questions during development and at the lunch checkpoint                                                                                                                                                                          |

## Organizer readiness checklist

The biggest platform risk is the relayer at the end of the afternoon, when all 10 teams test at once. The dry run a week before is the step that shows whether it holds.

**Relayer and platform**

- [ ] Confirm the app runs as a single replica during the event. The relayer lock only works within one process; more replicas risk `txBadSeq` failures.
- [ ] Confirm how often the cron jobs run, and put recommended minimum intervals in the brief so scheduled demos don't look stalled.
- [ ] Top up the relayer account with enough testnet XLM for a full day of fees.
- [ ] Check rate limits on `/api/v1` and the deploy routes against 10 teams working at once.
- [ ] Check Soroswap testnet liquidity for the pairs teams are likely to swap, if swap stays in the idea list.
- [ ] Dry run about a week before: 10 accounts deploying and triggering flows at the same time.
- [ ] Name one engineer on call for the whole event.
- [ ] Freeze `staging` from the day before the event until awards end.
- [ ] Check the Stellar testnet reset schedule when the date is set, and again two weeks before.

**Accounts and kit**

- [ ] Create 10 team accounts (plus 1–2 spares).
- [ ] Build and test the template repo from a clean machine.
- [ ] Write the AI context pack and try it with at least one AI assistant.
- [ ] Rehearse the onboarding demo for the online event.
- [ ] Create and fund three testnet wallets per team (plus spares) with XLM and 1,000 USDC each, trustline set (#726).
- [ ] Send the participant prep list with the onboarding invite.

**Judging and logistics**

- [ ] Confirm judges and brief them on the rubric and how to check a tx hash.
- [ ] Set up the submission form.
- [ ] Prepare the scoring sheet.
- [ ] Venue, Wi-Fi capacity, power, projector and a spare HDMI adapter.
- [ ] Registration form: consent to feature projects, photo consent, and the analytics notice.
- [ ] Name the organizer on duty for code-of-conduct reports.
- [ ] Set up QR Ph payouts for the five prizes.
- [ ] Agree how the Paiflow team picks the Paiflow Pick winner during deliberation.

## Risks and mitigations

The biggest avoidable risks are a mid-event redeploy and a testnet reset; both are fixed by choosing dates and freezing `staging`. The relayer concern is handled outside this doc.

| Risk                                            | What happens                                                                                                                                                                                                                                                           | Mitigation                                                                                                                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging redeploys during the event              | Any merge to `staging` restarts the beta app all 10 teams are using                                                                                                                                                                                                    | Freeze `staging` from the day before the event until awards end                                                                                                                              |
| Stellar testnet reset                           | Wipes every account, contract, uploaded WASM and the factory. Next scheduled reset: 16 Dec 2026, 17:00 UTC (17 Dec, 01:00 PHT). Resets happen 2–4 times a year and are announced at least 2 weeks ahead ([Stellar docs](https://developers.stellar.org/docs/networks)) | Keep the dry run, onboarding and event day on the same side of a reset. If one lands in between: re-upload WASM, redeploy the factory, sync hashes, re-fund team wallets, repeat the dry run |
| The whole venue shares one public IP            | Some limits count per IP: the deployment page's event catch-up allows 30 requests a minute per IP and fails silently. Five wrong passwords lock a team's shared account for 15 minutes                                                                                 | Test from one network in the dry run. Keep spare accounts and an admin ready to unlock                                                                                                       |
| The live feed lags up to about a minute         | Events arrive from a job that runs once a minute, so a 3-minute demo can look stalled                                                                                                                                                                                  | Tell teams to keep the tx open on an explorer as a backup                                                                                                                                    |
| Scheduled flows pay out only when the cron runs | Payroll, subscription and allowance teams can miss the gate                                                                                                                                                                                                            | Brief teams: first payout before 4:30. Put the cron intervals in the brief                                                                                                                   |
| Platform or RPC outage                          | Teams can't deploy or trigger                                                                                                                                                                                                                                          | Proposed: extend development by the outage length and shift pitching; accept recorded demos; on-call engineer                                                                                |
| Late arrivals and Wi-Fi setup                   | Eats into development part 1                                                                                                                                                                                                                                           | Open doors 30 minutes before 0:00 for check-in, Wi-Fi and a short rules recap                                                                                                                |
| Participants arrive without tools               | The first hour goes to installs                                                                                                                                                                                                                                        | Send a prep list with the onboarding invite: laptop and charger, a Stellar wallet extension, Node and git, a GitHub account, an AI assistant                                                 |
| The beta app sends analytics                    | Participants' use is tracked by PostHog                                                                                                                                                                                                                                | Add the analytics notice to the registration form                                                                                                                                            |

## Open questions

- [ ] Event date, start time and venue, plus the date and platform for the online onboarding (deferred). Keep them clear of a testnet reset.
- [ ] Who the judges are, and how many (deferred). Paiflow staff may judge.
- [ ] How participants register, and how the 10 teams are picked if more apply (deferred).
- [ ] How many mentors to have on the floor for 10 teams.
- [ ] Approve or change the proposed code of conduct and outage policy.
