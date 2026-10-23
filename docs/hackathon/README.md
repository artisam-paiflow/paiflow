# Hackathon documentation

This folder contains shared Paiflow developer instructions and event-specific planning documents. The Paiflow Guide is the main event-neutral end-to-end walkthrough; detailed SDK and HTTP instructions live in their GitHub READMEs. Event dates, preparation permissions, qualification, judging and submissions belong in each event's documents.

## Event primer template

Use the [Markdown template](event-primer-template.md) and [review PDF](event-primer-template.pdf)
to draft an event-specific primer. The [organiser notes](event-primer-template-notes.md)
explain the placeholders, schedule checks and suggested documentation structure.
Registration, submission, guides, starter, sample applications and support links belong
inside each event's primer. Resolve the placeholders before participant distribution.

## Participant distribution

Distribute exactly two PDF resources: the event-specific primer and the Paiflow Guide.
The primer contains event rules, timeline, judging, submissions and all resource links.
The guide covers wallets, flow deployment, a hosted payment, app integration and
verified payout, including essential recovery and troubleshooting.

Detailed integration references stay on GitHub:

- [SDK README](../../packages/sdk/README.md): typed Node integrations and recovery.
- [HTTP API README](../api/README.md): authentication, endpoints and a complete
  [custom browser/server example](../api/README.md#custom-browser-and-server-integration),
  with OpenAPI and Postman links.

The separate API quickstart Markdown/PDF and its dedicated renderer are retired.
Its useful setup, signing, submission, verification and recovery material is now in
the HTTP API README. Historical event PDFs and dated evidence remain archival;
they are not extra participant handouts. No bulk archive deletion is required.

Use the SDK as the default Node integration path. The [starter](https://github.com/artisam-paiflow/paiflow-hackathon-starter) demonstrates wallet connection, preparation, signing, submission, original-transaction status and browser recovery. It is a minimal example to adapt to an app, not a complete checkout or an independently verified payout receipt.

[Campus Snacks](https://github.com/artisam-paiflow/paiflow-campus-snacks) remains the domain sample for server-priced USDC purchases and a 90/10 split. Follow the sample's README for its USDC configuration, and use the SDK starter's payment pattern when adapting it. Preserve the menu, asset issuer, payout expectations and contribution jars.

## Files to keep in sync

Keep shared facts consistent without repeating every detail in every document. When behaviour changes, update the technical reference first, then the affected walkthroughs, samples and AI context. PDFs are generated copies of their Markdown sources; regenerate them when requested or before distributing a final revision.

Paths below are relative to this folder unless stated otherwise.

| File or document                                                                                                                          | Purpose                                                                                  | Keep aligned with                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Paiflow Guide](paiflow-guide.md)                                                                                                         | Two-part wallet/flow tutorial and SDK app integration walkthrough                        | `paiflow-guide.pdf`, SDK/API READMEs, current starter behaviour and tutorial videos                                        |
| [SDK README](../../packages/sdk/README.md)                                                                                                | Detailed typed Node integration examples, errors and recovery                            | SDK contract, API reference and package implementation                                                                     |
| [HTTP API README](../api/README.md)                                                                                                       | Detailed authentication, endpoints, constraints, errors and independent checkout example | OpenAPI, Postman, SDK README and shared AI context                                                                         |
| [OpenAPI JSON](../api/openapi.json)                                                                                                       | Machine-readable API contract                                                            | Source `lib/api/v1/openapi.ts`, route/schema definitions and the deployed `/api/v1/openapi.json`                           |
| [Postman collection](../api/paiflow-api-v1.postman_collection.json)                                                                       | Runnable API examples                                                                    | OpenAPI, API reference, request shapes and instance URLs                                                                   |
| [Shared developer context](llms.md)                                                                                                       | Technical instructions for AI-assisted development                                       | `llms.md` in the starter and Campus Snacks repos, API reference and actual product behaviour                               |
| [Starter repository](https://github.com/artisam-paiflow/paiflow-hackathon-starter): `README.md`, `AGENTS.md`, `.env.example`, `llms.md`   | Minimal SDK payment example, server configuration and transaction recovery               | Paiflow Guide, SDK/API READMEs, shared context and starter implementation                                                  |
| [Campus Snacks repository](https://github.com/artisam-paiflow/paiflow-campus-snacks): `README.md`, `AGENTS.md`, `.env.example`, `llms.md` | USDC sample app, server-priced menu and 90/10 checkout                                   | Starter integration conventions, shared context and sample implementation; preserve sample-specific behaviour              |
| [JRU event primer](jru/event-primer.md)                                                                                                   | Concise JRU overview using the shared event-primer format                                | `jru/event-primer.pdf` and the [JRU participant guide](participant-guide.md); JRU preparation rules, deadlines and judging |
| [FEU Tech event proposal](feu-tech/event-proposal.md)                                                                                     | Student-org planning draft: scope, timetable and responsibilities                        | `feu-tech/event-proposal.pdf` and the future participant brief; event rules must not leak into shared technical guides     |
| [Video tutorial prompt](video-tutorial-prompt.md) and `video-tutorial/` recording materials                                               | Tutorial planning, captions, narration and recording checks                              | Current guide steps, sample configuration and recorded app/wallet behaviour                                                |
| Recorded tutorial videos and their links                                                                                                  | Visual companions to the guides                                                          | Relevant guide section, actual UI and asset/network configuration; replace TBD links after recording                       |

## Early integration

The [Aklan event primer](aklan/event-primer.md) covers the October 20, 2026 hackathon. Its schedule and early-building permission are event-specific; outstanding planning details are tracked in the internal [organiser notes](aklan/organiser-notes.md).

Teams may deploy, integrate Paiflow and test payments before the event once credentials are available. Use the SDK in your own Node app or start from the minimal SDK payment example. The example enables payments once its server origin, explicit deployment ID and token are configured; without complete configuration, payment actions stay disabled. Event schedules describe time to finish and demonstrate integration. Retain published payout qualification and submission rules, including FEU's event-day qualifying payout. Keep participant briefs, starter guidance, AI context and tutorial scripts aligned.

## Hackathon feature availability

Dev mode will stay disabled for the duration of the hackathon. Participant instructions must use configured recipients and values in standard flows. Do not direct teams to Dev values, Fill value via API or per-payment payouts. Shared technical references may retain advanced Dev-mode details only with an explicit unavailable-during-this-hackathon note. The SDK payment example accepts only a testnet native-XLM Receive deployment and a fixed 1 XLM payment; it includes no per-payment recipient controls or advanced panels. Keep the starter README and shared `llms.md` copy aligned. Historical Web3 Iloilo materials retain their separate event scope.

## Public documentation

Developer READMEs and AI context guides link to GitHub Markdown sources so readers and AI tools can inspect the instructions and code examples. Keep those source links current when files are renamed. Starter and sample READMEs should point to the Paiflow Guide and canonical SDK/API READMEs; remove retired API PDF links when updating those separate repositories.

The established [Paiflow Guide Drive PDF](https://drive.google.com/file/d/1abY-gT2TERr_av3eRPHjc9e8vTfkDnuY/view?usp=sharing) is a distribution copy. After source approval and requested PDF regeneration, check its revision and update it before distribution. Use the event's approved primer PDF alongside it. Stop distributing the old API quickstart PDF; GitHub READMEs replace its detailed reference role. Existing Drive/Google Docs copies and separate starter/sample repositories are not updated by a local repository edit.

The Paiflow Guide Markdown and regenerated PDF contain two parts in one document:
the Paiflow app tutorial, then app integration through the SDK. The guide and primer
template include the SDK integration path and minimal payment example. JRU and FEU sources/PDFs remain out of
scope. Existing shared Drive/Google Docs copies need their own distribution update.

Participant-facing repository links use [`artisam-paiflow/paiflow` on `develop`](https://github.com/artisam-paiflow/paiflow/tree/develop/docs/hackathon). Keep the shared guides, PDFs and API resources aligned with that public copy. Before distributing the PDFs or updating starter/sample links, verify that every linked file exists on the public branch and contains the current revision.

## Sources and generated copies

- Product and API claims must match the implementation. A documentation edit does not change or deploy the app.
- The OpenAPI endpoint serves the definition in `lib/api/v1/openapi.ts`. Run `pnpm api:openapi` after changing that definition to refresh `docs/api/openapi.json`; the OpenAPI tests check for drift.
- A deployed spec may differ from the current repository. Verify its availability and contents before claiming the live API is current.
- Use `https://beta.app.paiflow.xyz` for the current beta instructions. Keep sample environment values and client defaults consistent with the documented origin.
- Shared instructions may use different examples: the beginner guide starts with XLM; Campus Snacks uses Circle testnet USDC. Preserve the correct asset, issuer, amounts and payout expectations for each example.
- Keep event-specific JRU/Iloilo instructions and older primer PDFs separate from the active FEU Tech documents. They are not sources for another event's rules.
- `temp-memory.md` files are local working notes, not participant documentation or published sources.

## PDF regeneration

The [Windows setup guide](setup-guide.md) and its [PDF](setup-guide.pdf) consolidate the former Engr and starter setup guides. Follow one path: install Git, NVM, Node and pnpm, run the Paiflow starter, then set up Engr with a Kimi API key. Follow the current starter README for configuration; this setup guide ends with the local app and coding tools ready.

After Markdown approval and an explicit request to regenerate, run from the repository root:

```bash
node scripts/render-developer-guide-pdf.mjs docs/hackathon/paiflow-guide.md
node scripts/render-setup-guide-pdf.mjs
node scripts/render-event-primer-pdf.mjs docs/hackathon/event-primer-template.md
```

The FEU proposal is an organiser planning artifact, not an additional participant PDF. Check page boundaries, code examples and links after rendering. Do not regenerate PDFs for every intermediate Markdown edit.

## Historical verification

On Oct 10, 2026, the [then-current API quickstart](https://github.com/webnxt-2030/pinkraft/blob/f5ae7e67f06f95b60c696bc835a455c98c20abbf/docs/hackathon/developer-api-quickstart.md)’s exact `route.js` and `page.js` example was exercised against `https://beta.app.paiflow.xyz` on app version `b945e6a`. A new standard XLM Receive → Split deployment was signed in an isolated Freighter browser. A 1 XLM payment returned `SUCCESS` through submission, transaction lookup and Stellar RPC at ledger 5123377; the recipients received 0.9 XLM and 0.1 XLM. The event endpoint returned the matching deposit and percentage Split payout records.

[Testnet transaction evidence](https://stellar.expert/explorer/testnet/tx/5db62598269536305986cd67da60ebb710e392bc7144b77449b330cc33df389d). The temporary API token was revoked after verification.

The historical receipt establishes that dated run only. The transferred example has not been rerun on-chain as part of this consolidation; local example tests do not establish hosted readiness.
