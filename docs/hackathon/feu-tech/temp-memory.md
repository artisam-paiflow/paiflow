# FEU Tech event proposal working memory

Updated October 9, 2026.

## Context

We are creating and refining an event primer for the Paiflow × FEU Tech hackathon. The user wants to resolve the review findings step by step. The primer is a planning draft for the FEU Tech student organisation, not the final public participant document. Detailed participant instructions will be provided in a separate participant brief. This file records the context and outstanding checklist; creating it does not resolve or approve any checklist item.

The starting primer in `docs/hackathon/feu-tech/participant-guide.md` and its PDFs contains JRU event details. We created separate FEU Tech files so the original material remains intact:

- Working primer: `docs/hackathon/feu-tech/event-proposal.md`.
- Matching PDF: `docs/hackathon/feu-tech/event-proposal.pdf`.
- PDF renderer: `scripts/render-event-primer-pdf.mjs`.
- Regenerate with: `node scripts/render-event-primer-pdf.mjs docs/hackathon/feu-tech/event-proposal.md`.

The current PDF has four pages and passed font-loading, page-boundary and visual checks after the latest edits. In this environment, Chromium rendering required execution outside the filesystem sandbox.

## Confirmed direction and current draft

- The user confirmed **October 28, 2026**, with the entire **8:00 AM–5:00 PM PHT** day dedicated to the hackathon. There are no seminar or workshop tracks.
- Use **TBD**, rather than TBA, for unresolved details.
- The current draft carries over **10 teams of 1–4 people** and a **PHP 10,000 prize pool across five awards** from the original. These are carried-over details rather than independently confirmed FEU Tech decisions.
- The user confirmed keeping the current detailed timetable, including **9:00 AM integration start** and **3:00 PM submission deadline**. No schedule changes were requested.
- After online onboarding, participants may scaffold their app and build non-payment screens/features. Paiflow integration is reserved for hackathon day.
- Participants may freely use the sandbox's available features before the event, including practice flows and payments. They may reuse their flow design, but must deploy from the team's event-day account and produce the qualifying payout during the integration window. Sandbox deployments do not provide API access for integrating their own app; verified in token-manager, API-auth and sandbox-path guards.
- Section 6 is **Event support and coordination**. Paiflow provides free lunch for up to **40 participants and 10 organisers**, the prize pool, developer support and hackathon mechanics.
- The FEU Tech student organisation handles logistics: venue, screen projection and a sound system if needed.
- The student organisation is welcome to suggest changes to any part of the event and propose additional expenses. Budget proposals should be submitted **as soon as possible**, before committing to expenses, for Paiflow to approve or request revisions.
- A reusable, organisation-agnostic video tutorial prompt is saved at `docs/hackathon/video-tutorial-prompt.md`. The user plans to give it to Claude later; creating the video is not the current task.
- The latest review made no changes to the primer. Live link checks were unavailable through the browsing tool, so current link accessibility and the beta site's tutorial were not confirmed.

## Review checklist

Line references below reflect the reviewed version and may shift as the primer is edited.

- [x] **1. Correct the AI context link — complete.** Revised `docs/hackathon/llms.md` into an event-neutral Paiflow developer context guide. Removed event dates, forms, fixed judging/pitch rules and support promises; event documents now supply those decisions. Updated the FEU Tech primer's link wording and regenerated its four-page PDF. Updated the starter repository's `llms.md`, `README.md` and `AGENTS.md`. [PR #6](https://github.com/artisam-paiflow/paiflow-hackathon-starter/pull/6) was squash-merged at the user's request on October 9, 2026, as commit `d7d5a5d6633c291169c97cb8ae393b22b62cdaf9`. Verified through the GitHub contents API that `main` now serves the event-neutral guide. Typecheck, production build, 68 tests and browser credential-marker scan passed before merging. The user's existing starter checkout was left untouched.

**Review pass finished.** Items 1–3 and 5 are resolved within the approved scope. Item 4 is skipped for now. Item 6 belongs in the separate participant brief; do not add preparation details to this planning primer. Item 7 is skipped for now; no additional organiser wording was added.

- [x] **2. Clarify the sandbox boundary — complete.** The user approved unrestricted practice within the sandbox's available features, reuse of practice flow designs, and an event-day team deployment and qualifying payout. Updated onboarding and the preparation timeline to remove the blanket prohibition on practice deployments/payments. Confirmed sandbox accounts cannot create API tokens and partner API authentication rejects sandbox-owned deployments (`lib/api/v1/tokens.ts`, `lib/api/v1/auth.ts`, `lib/sandbox-paths.ts`). The primer explains that sandbox deployments cannot be connected to a team's app through the API. Regenerated the matching PDF with page-boundary checks.

- [x] **3. Define qualification, scoring and pitch — complete within the user's chosen scope.** Added only the three requested summaries before the prize table: confirmed team deployment and a verifiable on-chain payout during the integration window; Creativity 30%, Integration 40%, Real-world usefulness 30%; five-minute slot split into three minutes for pitch/demo and two minutes for judges' Q&A. The user chose not to add special-award eligibility or tie-breaking rules at this step; those remain unspecified. Updated Markdown only; PDF regeneration is deferred.


- [ ] **4. Add registration and submission instructions — skipped for now at the user’s request.** We need a registration link/deadline, participant eligibility, and a submission link/checklist. Those can initially say TBD.

- [x] **5. Confirm the detailed timetable — complete.** The user chose to keep the current schedule without changes: 8:00 AM–5:00 PM overall, 9:00 AM integration start, noon–1:00 PM lunch, 3:00 PM submission deadline, 3:00–4:00 PM pitches, 4:00–4:30 PM deliberations and 4:30–5:00 PM closing/awards. Five scheduled building hours plus optional lunch coding. Suggestions to redistribute credentials or add checkpoints were not adopted.

- [ ] **6. Complete participant preparation guidance — deferred to the participant brief at the user’s request.** Add a brief “What to bring” note covering laptops, chargers, wallet setup and testnet funding. Clarify whether venue internet is provided or participants need hotspots; do not inherit JRU's internet requirement automatically.

- [ ] **7. Resolve organiser details — skipped for now at the user’s request.** Onboarding date/time, room and support contact are already marked TBD. Also specify the announcement channel, lunch headcount/dietary collection, and who receives budget proposals. Budget approval should explicitly precede spending.

- [ ] **8. Verify and clarify the tutorial claim.** The repository contains a homepage “quick explainer” video, but a tutorial on the live beta site was not confirmed. Distinguish that existing video from the hackathon tutorial the user plans to create.

## Working approach

Resolve the checklist one item at a time with the user. Do not silently treat proposed or carried-over details as confirmed. Edit Markdown only while refining the primer. Regenerate the PDF only when the user requests it; do not regenerate for each change. Mark an item complete only when its required decisions and edits are actually resolved.

The review suggested keeping the primer concise and creating a separate FEU Tech mechanics guide for detailed rules and setup, with a short qualification/judging summary in the primer. This is a recommendation, not an approved scope change.

## Latest correction

The user corrected the participant-facing app/sandbox URL to `https://beta.paiflow.xyz`. Updated the FEU Tech primer Markdown link. PDF regeneration was interrupted and is deferred; the Markdown is the current source. This correction applies to the primer; API origins and other documents have not been changed. Next item to discuss is #8: tutorial claim. The user confirmed the current timetable; item #4 remains skipped and item #6 is deferred to the participant brief.

## Audience clarification

The user clarified that this primer gives a draft overview to the student organisation, rather than serving as the final public document for participants. Added a prominent note after the updated date. Participant preparation guidance is deferred to a separate participant brief. Markdown only; PDF regeneration remains deferred.

## Review pass status

The user moved on after the proposed tutorial wording; item 8 remains pending and the primer's tutorial claim has not been changed. There are no further numbered review items. Completed: 1, 2, 3 (approved scope only) and 5. Skipped for now: 4 and 7. Deferred to the participant brief: 6. Pending: 8. No PDF regeneration should occur until explicitly requested.

## Requested PDF regeneration

At the user’s request, regenerated the current four-page PDF after the review pass. Adjusted the renderer so prizes and coordination share page 4, and slightly reduced the cover header padding. Font loading and page-boundary checks passed. The planning-draft note, corrected beta.paiflow.xyz URL, sandbox policy, and qualification/scoring/pitch summaries are now in the PDF. The tutorial availability claim remains unchanged (item 8 pending). Updated the saved Claude prompt with the corrected URL, event-neutral guide description and the sandbox API limitation. Continue Markdown-only edits until PDF regeneration is requested again.

## Document naming

The user approved renaming the planning document to **Paiflow × FEU Tech Hackathon — Event Proposal**. Renamed the current Markdown source to `docs/hackathon/feu-tech/event-proposal.md` and adjusted its self-references. The separate participant-facing document will be a participant brief. The existing PDF remains `event-primer-full-day.pdf`, with its previous title; regeneration is deferred until requested. On regeneration, use `node scripts/render-event-primer-pdf.mjs docs/hackathon/feu-tech/event-proposal.md` to create `event-proposal.pdf`. Check that the longer title fits the cover and footer.

## Event proposal PDF regenerated

At the user’s request, generated `docs/hackathon/feu-tech/event-proposal.pdf` with the approved Event Proposal title. Adjusted cover font size and padding for longer titles; font loading and page-boundary checks passed, and the cover was visually inspected. The earlier `event-primer-full-day.pdf` is an older artifact. Continue Markdown-only editing unless regeneration is requested.

## Developer guide created

The user requested a human-readable developer guide, saved in the FEU Tech folder for now, with Markdown and a PDF matching the proposal style. Created `docs/hackathon/feu-tech/developer-guide.md` and `developer-guide.pdf`. The event-neutral walkthrough uses native XLM with a 90/10 Receive → Split flow, then covers Freighter setup/Friendbot funding, deployment review, hosted-page payment, API token creation, starter preparation/team modes, an app payment, customisation and troubleshooting. It distinguishes sandbox practice from full/team-account API access and uses `https://beta.paiflow.xyz`.

Renderer: `scripts/render-developer-guide-pdf.mjs`. Regenerate with `node scripts/render-developer-guide-pdf.mjs docs/hackathon/feu-tech/developer-guide.md`. Six A4 pages, the same Space Grotesk/Geist/JetBrains Mono fonts, dark/pink cover, numbered sections, table styling and footer system as the proposal. Font loading, page boundaries and PDF text checks passed; cover, configuration and troubleshooting pages were visually inspected. Instructions were checked against the repository quickstart, technical reference, starter UI/client/configuration and official Stellar Freighter setup docs. No live end-to-end walkthrough was run; the browser tool could not access beta during this task. Existing quickstart and llms.md were not changed.

## Commit and draft PR

Committed this session’s documentation on local `hackathon-staging` as `7982fe2` (eight files: proposal/guide Markdown and PDFs, shared llms.md, tutorial prompt and two PDF renderers). Opened [incomplete draft PR #871](https://github.com/webnxt-2030/pinkraft/pull/871) from `docs/feu-tech-event-proposal` into `hackathon-staging`. Pushed only the PR branch; remote staging was not advanced. The PR lists outstanding planning decisions, participant brief, tutorial verification and live developer walkthrough. Working memory, earlier primer PDF, separate video-production files, browser state and output assets were left uncommitted.
