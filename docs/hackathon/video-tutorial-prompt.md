# Paiflow hackathon video tutorial prompt

Create a beginner-friendly video tutorial introducing Paiflow to hackathon participants. Keep it reusable across events: do not mention specific schools, organisations, dates, venues, prizes or schedules.

First, inspect the repository and relevant documentation:

- docs/hackathon/llms.md
- packages/sdk/README.md
- docs/api/README.md
- docs/hackathon/participant-guide.md

The developer context guide is event-neutral; some supporting files contain event-specific instructions. Extract the shared product guidance without carrying event logistics into the video. Verify product behavior against the current app and code. Flag anything uncertain instead of inventing features.

## Audience and tone

- Students and developers who may know basic app development but have no blockchain experience.
- Use plain English, clear visuals and concrete examples.
- Explain unfamiliar terms briefly when they first appear.
- Aim for 5–7 minutes, focused on understanding Paiflow and completing a first payment.

## Explain Paiflow

- Paiflow is the payment logic behind an app.
- Developers visually connect triggers, conditions and payment actions, then deploy the flow as Stellar smart contracts.
- Their app handles the user experience: who pays and why.
- Their Paiflow flow handles when money moves and where it goes.
- Introduce practical uses such as checkout, group dues, recurring allowances and donation splitting.

## Demonstrate one simple example

Use a snack shop where a customer's payment automatically splits:

- 90% to the shop.
- 10% to a community fund.

Show the complete journey:

1. Open https://beta.app.paiflow.xyz and explain the sandbox.
2. Create an “on receive → split” flow with Dev mode off. Explain that Dev mode will stay disabled for the duration of the hackathon; configure recipients before deployment.
3. Configure the asset, recipient addresses and percentages.
4. Review the flow's English preview.
5. Demonstrate deployment with a testnet wallet and wait for CONFIRMED.
6. Open the payment/QR page and make a test payment.
7. Show the confirmed payout in the live feed, recipient balances or a Stellar explorer.
8. Explain how a developer's own app connects through hosted payment pages or the API. Clarify that sandbox accounts cannot create deployment API tokens or use the partner API for their deployments. Demonstrate API integration only with a full/team account and its deployment, or label this part as an explanation if that access is unavailable.

Keep the integration explanation brief and visual. Explain that one deployment serves a business or group and can receive payments from multiple customers. A new deployment is not needed for every customer.

## Hackathon preparation

- Participants can explore the sandbox and watch tutorials to learn how Paiflow works.
- Explain app scaffolding: setting up the project, building screens and developing non-payment features.
- Explain that teams may deploy, integrate and test payments before the event once credentials are available. Follow the participant brief for qualifying evidence and submission rules.
- Preparation mode is optional: choose team mode as soon as the confirmed deployment and API token are ready. Dev mode stays disabled throughout the hackathon.
- Clearly distinguish learning in the sandbox from building and testing the team's actual hackathon deployment.
- Do not present one event's preparation rules as universal.

## Essential reminders

- Use Stellar testnet for this tutorial; testnet funds have no real-money value.
- Never expose wallet secret keys, account credentials or API tokens.
- Keep API tokens on the app's server.
- Replace placeholder recipient addresses with actual testnet addresses.
- Show how to save the deployment ID and payout transaction hash as evidence; explain that submission and qualification requirements depend on the event.
- Encourage teams to get their first confirmed payout working before polishing their app.

## Production requirements

- Use actual app screens where possible.
- Match the app's current labels and behavior.
- Use readable zooms, cursor highlights and short captions.
- Clearly label illustrative mockups.
- Avoid lengthy code walkthroughs and unsupported claims.
- Keep all narration, captions and visuals independent of any particular event or organisation.

## Deliver

1. A concise video outline with timestamps.
2. A complete narration script.
3. A scene-by-scene storyboard with screen actions, visuals and on-screen text.
4. A recording checklist, including the testnet setup needed.
5. The finished video if your tools support rendering; otherwise, provide production-ready materials and clearly state what remains to be recorded or rendered.
