# Paiflow × «EVENT_PARTNER» — Event Primer

Template for review · «UPDATED_DATE» · «VERSION»

Build an app that solves a real problem with automated payments through Paiflow. Your app handles the customer experience; your flow handles when money moves and where it goes. «EVENT_THEME_OR_OPEN_CHALLENGE»

## At a glance

| Item                   | Details                                                    |
| ---------------------- | ---------------------------------------------------------- |
| Date and time          | «EVENT_DATE» · «START_TIME»–«END_TIME» · «TIMEZONE»        |
| Venue or online access | «VENUE_AND_ROOM_OR_MEETING_LINK»                           |
| Format and eligibility | «IN_PERSON_ONLINE_OR_HYBRID» · «WHO_CAN_JOIN»              |
| Teams                  | «MAX_TEAMS» teams · «MIN_TEAM_SIZE»–«MAX_TEAM_SIZE» people |
| Registration deadline  | «REGISTRATION_DEADLINE_WITH_TIMEZONE»                      |
| Submission deadline    | «SUBMISSION_DEADLINE_WITH_TIMEZONE»                        |
| Prize pool             | «CURRENCY_AND_TOTAL_OR_NO_PRIZES»                          |
| Network                | Stellar testnet; testnet funds have no real-money value    |

## Preparation and integration timeline

**Before the event — plan:** choose a problem, sketch your app and register by «REGISTRATION_DEADLINE_WITH_TIMEZONE».

**Before the event — prepare and integrate:** set up wallets and testnet funds using the Paiflow guide. USDC needs its exact trustline and separate funding; Friendbot supplies XLM only. «EARLY_DEPLOYMENT_API_INTEGRATION_AND_TEST_PAYMENT_POLICY».

**During the event — finish and demonstrate:** use «EVENT_BUILD_WINDOW_WITH_TIMEZONE» to complete integration, verify a payout, collect evidence and prepare your pitch. Early preparation does not replace the qualifying payout requirement below.

**Qualifying payout window:** «EARLIEST_AND_LATEST_QUALIFYING_PAYOUT_TIMES_WITH_TIMEZONE». «WHETHER_PRE_EVENT_DEPLOYMENTS_AND_PAYOUTS_QUALIFY». Shared-demo and sandbox payouts do not establish your team's integration.

**Submission deadline:** «SUBMISSION_DEADLINE_WITH_TIMEZONE» via «SUBMISSION_URL». Submit your evidence on time, even if app polishing continues. «LATE_SUBMISSION_AND_TECHNICAL_FAILURE_POLICY».

## Event program

Prepare before the event, use the event's build sessions to finish and demonstrate your app, then submit before the deadline. The preparation timeline above states what is permitted early and when a payout counts for qualification.

The schedule lists event-day activities. All preparation permissions and qualifying evidence dates must be read together with that schedule.

### Hackathon schedule

All times are in **«TIMEZONE»**. «BREAK_AND_REMOTE_ATTENDANCE_DETAILS»

| Time                           | Activity              | What happens                                                                            |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| «CHECK_IN_START_END»           | Check-in and briefing | Confirm attendance, rules and support access                                            |
| «BUILD_SESSION_1_START_END»    | Build and integration | Work toward a confirmed payout                                                          |
| «BREAK_START_END»              | Break                 | «BREAK_PROVISIONS_AND_OPTIONAL_CODING_RULE»                                             |
| «BUILD_SESSION_2_START_END»    | Build and integration | Finish the app and prepare evidence                                                     |
| «SUBMISSION_WINDOW»            | Submission            | Submit by «SUBMISSION_DEADLINE»; «OVERLAP_WITH_BUILD_SESSION»                           |
| «PITCHING_START_END»           | Pitching              | «TEAM_COUNT» × «MINUTES_PER_TEAM» minutes, plus «TRANSITION_AND_BUFFER_MINUTES» minutes |
| «JUDGING_START_END»            | Judging               | Verify evidence and finalise scores                                                     |
| «AWARDS_AND_CLOSING_START_END» | Awards and closing    | Announce results and next steps                                                         |

## The challenge

**Build for a real user.** «THEME_CONSTRAINTS_OR_OPEN_THEME». Explain the problem, why your flow fits it and how your app makes the payment useful.

Paiflow turns a visual flow into Stellar smart contracts. One deployment can serve a business or group and accept payments from multiple customers. The SDK and HTTP integration API operate existing deployments; they do not create a separate deployment for every app user.

| Idea            | What it does                                    | Paiflow pieces                      |
| --------------- | ----------------------------------------------- | ----------------------------------- |
| Shared checkout | Split each sale between a shop and a partner    | On Receive → Split                  |
| Creator tip jar | Share tips among collaborators                  | On Receive → Split                  |
| Event tickets   | Route ticket payments to a configured recipient | On Receive → Pay                    |
| Donation drive  | Share donations and show confirmed payouts      | On Receive → Split, public activity |

**Feature availability:** «APPROVED_FEATURES_AND_EXCLUSIONS_FOR_THIS_EVENT». Use standard flows with recipients configured before deployment as the baseline. Mutable dev-mode flows and per-payment-recipient APIs have been removed. Advanced automation must not be assumed available.

Configure your deployment's recipients and asset, then integrate the SDK into your app. The starter is a minimal SDK payment example. Use your own team's deployment for qualifying evidence.

Never store customer wallet secret keys in your app. Keep developer/deployment API tokens and webhook secrets on your server. Each customer authorises their payment in their own wallet.

Explain who pays, what triggers the flow and who receives the payout. Show the confirmed outcome in your demo and retain its transaction hash.

For Node integrations, use the published `@paiflow/sdk@0.2.0` beta for typed calls. Direct HTTP APIs remain available for other integrations. Read the developer docs and check the event deployment's capabilities and live state; package support alone does not establish feature readiness.

**Before choosing an advanced idea:** ask «TECHNICAL_SUPPORT_CHANNEL» about supported assets, fees, scheduled payouts, recurring charges or callbacks. Unattended scheduling and low fees must not be promised from SDK test coverage.

## Prizes

**Qualification:** «CONFIRMED_TEAM_DEPLOYMENT_AND_VERIFIABLE_PAYOUT_REQUIREMENTS». Apply the evidence window above. «NON_QUALIFYING_TEAM_PITCH_AND_PRIZE_POLICY»

**Public judging criteria:** «CRITERIA_WEIGHTS_AND_DESCRIPTIONS_TOTAL_100_PERCENT». Publish any live-versus-recorded demo scoring difference here: «DEMO_SCORING_POLICY». Full internal judge instructions must apply these published rules.

**Pitch format:** «PITCH_AND_DEMO_MINUTES» minutes plus «QA_MINUTES» minutes for questions. «ORDER_TIMER_SETUP_AND_FALLBACK_RECORDING_RULES»

**Awards:** «AWARD_NAMES_AMOUNTS_AND_ELIGIBILITY». «MULTIPLE_AWARD_RULE_AND_TOO_FEW_QUALIFYING_TEAMS_POLICY». «TIE_BREAK_RULE». «PRIZE_DELIVERY_METHOD_AND_TIMING»

## Event support and coordination

### Submission checklist

Submit at **«SUBMISSION_URL»** by **«DEADLINE_AND_TIMEZONE»**: team details, project summary, «SOURCE_OR_DEMO_LINKS», deployment ID, payout transaction hash and «DEMO_REQUIREMENTS». «PAYOUT_EVIDENCE_REQUIREMENTS». Never submit tokens, private keys or signed envelopes.

### Resources and support

| Resource                    | Link or contact                                                       |
| --------------------------- | --------------------------------------------------------------------- |
| Registration and submission | «REGISTRATION_URL» · «SUBMISSION_URL»                                 |
| Paiflow app and setup guide | «APP_URL» · «PAIFLOW_GUIDE_URL»                                       |
| SDK and HTTP API docs       | «SDK_README_URL» · «API_README_URL»; API includes OpenAPI and Postman |
| SDK payment example         | «STARTER_URL»                                                         |
| Sample applications         | «SAMPLE_SOURCE_AND_DEMO_URLS»                                         |
| Tutorials and AI context    | «TUTORIAL_URL» · «AI_CONTEXT_URL»                                     |
| Support and announcements   | «SUPPORT_CONTACT_AND_AVAILABILITY»                                    |

### What to prepare and bring

Bring «EQUIPMENT_INTERNET_AND_POWER_REQUIREMENTS». Install the versions listed in the starter's current instructions and prepare a GitHub account and supported testnet wallet. «MEALS_ACCESSIBILITY_AND_VENUE_OR_REMOTE_PROVISIONS»

**Shared rules:** use Paiflow for the core payment flow; use testnet only. «AI_OPEN_SOURCE_AND_EXISTING_WORK_DISCLOSURE_POLICY». No API or relayer load-testing or spam. «CONDUCT_PRIVACY_RECORDING_AND_DISPUTE_CONTACT». «HOW_RULE_CHANGES_WILL_BE_ANNOUNCED»
