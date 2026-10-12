# Hackathon documentation

This folder contains shared Paiflow developer instructions and event-specific planning documents. The Paiflow Guide and API quickstart are organisation- and event-neutral. Event dates, preparation permissions, qualification, judging and submissions belong in each event's documents.

## Files to keep in sync

Keep shared facts consistent without repeating every detail in every document. When behaviour changes, update the technical reference first, then the affected walkthroughs, samples and AI context. PDFs are generated copies of their Markdown sources; regenerate them when requested or before distributing a final revision.

Paths below are relative to this folder unless stated otherwise.

| File or document                                                                                                                          | Purpose                                                                                                              | Keep aligned with                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [Paiflow Guide](paiflow-guide.md)                                                                                                     | Human-readable wallet, flow, deployment and starter walkthrough                                                      | `paiflow-guide.pdf`, API quickstart, current starter behaviour and tutorial videos                                   |
| [API quickstart](developer-api-quickstart.md)                                                                                             | Custom frontend/backend integration without the starter: prepare, sign, submit, look up transactions and read events | `developer-api-quickstart.pdf`, full API reference, OpenAPI and working API routes                                     |
| [Full API reference](../api/README.md)                                                                                                    | Detailed authentication, endpoints, constraints and errors                                                           | OpenAPI, Postman, API quickstart and shared AI context                                                                 |
| [OpenAPI JSON](../api/openapi.json)                                                                                                       | Machine-readable API contract                                                                                        | Source `lib/api/v1/openapi.ts`, route/schema definitions and the deployed `/api/v1/openapi.json`                       |
| [Postman collection](../api/paiflow-api-v1.postman_collection.json)                                                                       | Runnable API examples                                                                                                | OpenAPI, API reference, request shapes and instance URLs                                                               |
| [Shared developer context](llms.md)                                                                                                       | Technical instructions for AI-assisted development                                                                   | `llms.md` in the starter and Campus Snacks repos, API reference and actual product behaviour                           |
| [Starter repository](https://github.com/artisam-paiflow/paiflow-hackathon-starter): `README.md`, `AGENTS.md`, `.env.example`, `llms.md`   | Setup, prepare/team/demo modes, configuration and development guidance                                               | Paiflow Guide, API quickstart, shared context and starter implementation                                             |
| [Campus Snacks repository](https://github.com/artisam-paiflow/paiflow-campus-snacks): `README.md`, `AGENTS.md`, `.env.example`, `llms.md` | USDC sample setup, prepare/team controls and 90/10 checkout                                                          | Starter integration conventions, shared context and sample implementation; preserve sample-specific behaviour          |
| [JRU event primer](jru/event-primer.md) | Concise JRU overview using the shared event-primer format | `jru/event-primer.pdf` and the [JRU participant guide](participant-guide.md); JRU preparation rules, deadlines and judging |
| [FEU Tech event proposal](feu-tech/event-proposal.md)                                                                                     | Student-org planning draft: scope, timetable and responsibilities                                                    | `feu-tech/event-proposal.pdf` and the future participant brief; event rules must not leak into shared technical guides |
| [Video tutorial prompt](video-tutorial-prompt.md) and `video-tutorial/` recording materials                                               | Tutorial planning, captions, narration and recording checks                                                          | Current guide steps, sample configuration and recorded app/wallet behaviour                                            |
| Recorded tutorial videos and their links                                                                                                  | Visual companions to the guides                                                                                      | Relevant guide section, actual UI and asset/network configuration; replace TBD links after recording                   |

## Hackathon feature availability

Dev mode will stay disabled for the duration of the hackathon. Participant instructions must use configured recipients and values in standard flows. Do not direct teams to Dev values, Fill value via API or per-payment payouts. Shared technical references may retain advanced Dev-mode details only with an explicit unavailable-during-this-hackathon note. The starter checks deployment capabilities and hides unsupported per-payment recipient controls. Keep the starter README and shared `llms.md` copy aligned. Historical Web3 Iloilo materials retain their separate event scope.

## Public documentation

Developer READMEs and AI context guides link to GitHub Markdown sources so readers and AI tools can inspect the instructions and code examples. Keep those source links current when files are renamed. The starter README also offers PDF copies.

Participant-facing guide links use the shared Google Drive PDFs for the [Paiflow Guide](https://drive.google.com/file/d/1abY-gT2TERr_av3eRPHjc9e8vTfkDnuY/view?usp=sharing) and [API quickstart](https://drive.google.com/file/d/1mTFaoICZwW2Ha3OttgJkp2q50o2H5siJ/view?usp=sharing). When either guide changes, regenerate its PDF and update the corresponding shared Google Drive file before distributing the revision. Update any related Google Docs copies as well, so participants opening the shared links see the latest version. Preserve the existing sharing links where possible.

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

Run from the repository root:

```bash
node scripts/render-developer-guide-pdf.mjs docs/hackathon/paiflow-guide.md
node scripts/render-api-quickstart-pdf.mjs docs/hackathon/developer-api-quickstart.md
node scripts/render-event-primer-pdf.mjs docs/hackathon/feu-tech/event-proposal.md
node scripts/render-event-primer-pdf.mjs docs/hackathon/jru/event-primer.md
```

Check page boundaries, code examples and links after rendering. Do not regenerate PDFs for every intermediate Markdown edit.

## Verification

On Oct 10, 2026, the API quickstart’s exact `route.js` and `page.js` example was exercised against `https://beta.app.paiflow.xyz` on app version `b945e6a`. A new standard XLM Receive → Split deployment was signed in an isolated Freighter browser. A 1 XLM payment returned `SUCCESS` through submission, transaction lookup and Stellar RPC at ledger 5123377; the recipients received 0.9 XLM and 0.1 XLM. The event endpoint returned the matching deposit and percentage Split payout records.

[Testnet transaction evidence](https://stellar.expert/explorer/testnet/tx/5db62598269536305986cd67da60ebb710e392bc7144b77449b330cc33df389d). The temporary API token was revoked after verification.
