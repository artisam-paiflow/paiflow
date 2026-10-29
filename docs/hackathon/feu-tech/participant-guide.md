# JRU Event Primer

Updated Oct 7, 2026

The Paiflow event at JRU combines a morning talk with two parallel tracks: a mini hackathon and a workshop and seminar. Hackathon teams build an app that solves a real problem with automated payments through Paiflow.

Configure all required values before deployment. Mutable dev-mode flows have been removed (#1138).

## At a glance

| Item              | Details                                                        |
| ----------------- | -------------------------------------------------------------- |
| When and where    | October 14, 2026 · José Rizal University · 8:30 AM–5:30 PM PHT |
| Tracks            | Mini hackathon: H412 · Workshop/seminar: H407                  |
| Teams             | 10 teams of 1–4 people                                         |
| Online onboarding | October 12, 2026 · 9:00 PM PHT                                 |
| Prize pool        | PHP 10,000 across five awards                                  |
| Network           | Stellar testnet                                                |

## Event program

### Online onboarding

**For hackathon participants only.** October 12, 2026, at **9:00 PM PHT**. Hear the rules and watch a live Paiflow demo: build, deploy, scan the QR and see the payout. The meeting link will be provided through **blockhub.academy** or the student organisation representatives.

### Shared morning program

| Time          | Activity     |
| ------------- | ------------ |
| 8:30–9:00 AM  | Registration |
| 9:00–9:30 AM  | Opening      |
| 9:30–10:30 AM | Morning talk |

After the talk, hackathon participants proceed to **H412**. Participants who are not joining the hackathon move to **H407** for the workshop and seminar.

### Mini hackathon

**Venue: Room H412, JRU.**

| Time              | Activity              | What happens                                                                                                     |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 10:30 AM–12:30 PM | Integration           | Deploy your flow and aim for your first confirmed payout                                                         |
| 12:30–1:30 PM     | Break                 | Optional coding; check your deployment and payout evidence                                                       |
| 1:30–3:30 PM      | Build and integration | Complete integration and prepare your demo                                                                       |
| 3:00–3:30 PM      | Submission            | During the final 30 minutes of development, submit before 3:30 PM with your deployment ID and payout transaction |
| 3:30–4:30 PM      | Pitching              | 10 teams × 5 minutes; random order drawn at 3:30 PM                                                              |
| 4:30–5:00 PM      | Deliberations         | Judges deliberate                                                                                                |
| 5:00–5:30 PM      | Closing and awards    | Announce prize winners and deliver closing remarks                                                               |

### Workshop and seminar

**Venue: Room H407, JRU.**

Participants who are not joining the hackathon move to the workshop and seminar after the morning talk. This track focuses on blockchain.

## Preparation and integration timeline

**Starting now:** choose a problem, talk to potential users and sketch your app.

**Before the event:** build your app, deploy flows, connect Paiflow and test payments. Ask organisers for team credentials in advance; switch the starter to `team` when your deployment and token are ready.

**October 14, 10:30 AM PHT:** continue development, finish your integration and prepare the demo. Early deployment, API integration, wallet preparation and test payments are allowed.

**Event development session:** starts at **10:30 AM PHT on October 14**. Use it to finish integration and prepare your demo; early integration is allowed.

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

For setup instructions and example payment flows, see the [AI context pack](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms.md). Confirm feature availability with [support](mailto:paiflow+jru.hack@artisam.xyz) before choosing an idea.

**Support contact:** [paiflow+jru.hack@artisam.xyz](mailto:paiflow+jru.hack@artisam.xyz).

Testnet funds have no real-money value. Never store wallet secret keys in your app.

Set up Paiflow once for the business, group or branch your app serves. For example, [Campus Snacks](https://campus-snacks.up.railway.app) represents one branch of a snack shop. Each customer pays separately, but every payment uses the same setup: 90% goes to the shop and 10% to the student organisation. You don’t need a new setup for each customer.

If your idea requires a separate payment setup for every customer, explain that as a future feature in your pitch.

## Prizes

PHP 10,000 across five awards, for qualifying teams only.

| Award                      | Prize (PHP) | How it's decided                                         |
| -------------------------- | ----------- | -------------------------------------------------------- |
| 1st place                  | 4,000       | Highest score                                            |
| 2nd place                  | 2,500       | Second-highest score                                     |
| 3rd place                  | 1,500       | Third-highest score                                      |
| Best Integration           | 1,000       | Highest Integration score among eligible teams           |
| Best Real-World Usefulness | 1,000       | Highest Real-world usefulness score among eligible teams |
