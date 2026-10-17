# Event primer template — organiser notes

Drafted October 16, 2026 for review. Companion to [the Markdown template](event-primer-template.md) and [PDF](event-primer-template.pdf). These notes are internal drafting guidance; the filled event primer is participant-facing.

## How to use it

1. Copy the template into the event's directory as `event-primer.md`. Preserve previous event documents and evidence.
2. Replace every `«PLACEHOLDER»` with an approved decision, actual link or explicit statement that the item does not apply. Remove drafting instructions from the participant version.
3. Publish one event-specific primer with registration, submission, developer resources and support links inside it. No separate participant resource hub is needed.
4. Keep wallet/code walkthroughs in the Paiflow and developer docs. Link to their canonical sources rather than copying them into the primer.
5. Render and review the event PDF after the Markdown is approved. Update distributed copies together and keep the same source revision identifiable.

The structure is based on the [JRU primer](jru/event-primer.md). It borrows the explicit qualification and coordination prompts from the [FEU proposal](feu-tech/event-proposal.md), without carrying over either event's rules, dates, prizes or benefits.

## Decisions to settle for every event

| Decision            | Suggested approach                                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Early preparation   | Explicitly distinguish ideation, app development, deployment, API integration and test payments. Do not inherit JRU, FEU or Iloilo permissions accidentally.                                    |
| Qualification       | Name the team's deployment, required payout proof and exact evidence window. State whether a pre-event deployment or payout qualifies.                                                          |
| Availability        | Confirm the event's target build, assets, wallet path and actual feature readiness. Start with standard Receive → Pay/Split examples; add advanced examples only when supported for that event. |
| Judging             | Publish criteria, descriptions and weights totalling 100%, plus any live/recorded demo distinction. Keep calculation instructions and judge worksheets internal.                                |
| Awards              | Decide overlap, ties, insufficient qualifying teams, delivery method and timing. Do not copy a prize pool or sponsor benefit without confirmation.                                              |
| Logistics           | Resolve team eligibility, registration/submission deadlines, room or meeting access, internet, meals, accessibility and support availability.                                                   |
| Privacy and conduct | State recording/analytics expectations, evidence visibility, permitted use of AI/existing work and the dispute contact.                                                                         |

## Schedule check

Allocate **team count × (pitch + Q&A + transition time), plus a buffer**. Keep the schedule table and pitch instructions consistent.

The JRU source currently schedules 10 teams × 8 minutes inside 60 minutes. That needs at least 80 minutes before transitions or a buffer. For illustration, 10 teams × (5-minute pitch + 3-minute Q&A + 1-minute transition) needs 90 minutes; a further 10-minute buffer makes 100 minutes. This is a planning example, not the template's required format.

Also check that submission closes before judging needs final evidence, overlapping submission/build windows are labelled, breaks are explicit, and the closing time accommodates the complete program. Use a named timezone for every deadline, especially for online events.

Distribute only the event primer and Paiflow Guide as PDFs. Keep detailed SDK and HTTP API instructions in their GitHub READMEs, linking OpenAPI and Postman from the API README. Older PDFs are archival, not additional participant handouts.

## Resource defaults to review

| Template field     | Suggested source                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paiflow guide      | [Canonical guide](paiflow-guide.md); use the established shared PDF link only after its distributed revision is checked.                                                                                                      |
| SDK docs           | [SDK README](../../packages/sdk/README.md), with supplementary [quickstart](../sdk/quickstart.md) and [coverage contract](../sdk/contract.md). Select publicly accessible URLs for the participant PDF.                       |
| API docs           | [HTTP reference](../api/README.md), [OpenAPI](../api/openapi.json) and [Postman](../api/paiflow-api-v1.postman_collection.json).                                                                                              |
| Starter            | [Minimal SDK payment example](https://github.com/artisam-paiflow/paiflow-hackathon-starter); Node `>=22.22.2 <23`, server-only SDK `0.2.0`, explicit deployment and token.                                                    |
| Sample application | [Campus Snacks source](https://github.com/artisam-paiflow/paiflow-campus-snacks); preserve its USDC 90/10 use case when migrating it from the SDK starter. Verify availability and configuration before adding its live demo. |
| AI context         | [Shared developer context](llms.md); event instructions belong in the primer or a small event-specific companion.                                                                                                             |

Verify links without an organiser login before distribution. Template URLs are deliberate placeholders, not live links. Do not send a participant primer containing unresolved form, support or resource placeholders.

The [API verification summary](../api/README.md#hosted-testnet-verification) distinguishes recorded testing/testnet successes from later fee-blocked Subscription/Schedule payouts and unverified unattended scheduling. It does not certify the event's deployment or guarantee low transaction fees.

## Suggested documentation structure

- **External:** the filled event primer; Paiflow guide; SDK/API docs; starter; sample applications. Keep all event resource links inside the primer.
- **Internal:** this template and its drafting notes; judge scoring/evidence instructions and worksheets; an organiser runbook for provisioning, funding, readiness, support and cleanup.
- **Archive:** past events, superseded drafts/PDFs and dated verification evidence, clearly labelled and linked where useful.

These are structure suggestions for review. This task does not move or remove existing documents, create the judging guide/runbook, or change an event's published rules.

## Rendering and review

From the repository root:

```bash
node scripts/render-event-primer-pdf.mjs docs/hackathon/event-primer-template.md
```

The existing renderer expects the template's major headings and a challenge examples table. It produces four fixed pages and rejects content exceeding their bounds. If a filled event primer becomes longer, shorten repetition or deliberately revise the layout; never distribute a clipped PDF.

Before distribution, confirm all placeholders are resolved, weights and prize totals reconcile, schedule arithmetic fits, links are accessible, and PDF text matches the approved Markdown. Inspect all pages for clipping, awkward breaks and readable links.
