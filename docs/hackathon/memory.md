# Web3 Iloilo hackathon working memory

Updated October 7, 2026.

## Current state and event decisions

Participant guide and six-page A4 PDF are complete for the current decisions; no saved edits remain pending. The PDF uses the JRU guide's typography, pink accents, lavender tables, heading dividers and footer. Existing JRU participant documents were left unchanged.

- Onboarding / pre-event: **October 16, 2026**; hackathon: **October 18, 2026**. Both **online**; times and meeting links TBA.
- Audience: **Web3 Iloilo**. Capacity: **10 teams of 1–4 people, open to discussion**.
- Schedule and Paiflow integration duration: **TBD**. Do not restore the old fixed four-hour integration window or derived submission offsets. One note states all times are Philippine Time.
- Registration form/deadline: **TBA**. Submission form: **link coming soon**; submissions October 18, deadline time TBA.
- Support: **paiflow+iloilo.hack@artisam.xyz**.
- Participant-facing material should omit internal draft labels, JRU comparisons and commentary about proposed/unconfirmed rules. Use concise placeholders for missing logistics; fill them before registration and onboarding.

## Artifacts and regeneration

- Guide: `docs/hackathon/web3-iloilo/participant-guide.md`.
- PDF: `docs/hackathon/web3-iloilo/participant-guide.pdf`.
- Local AI context pack: `docs/hackathon/web3-iloilo/llms.md`.
- Renderer: `scripts/render-hackathon-guide-pdf.mjs`.
- Regenerate: `node scripts/render-hackathon-guide-pdf.mjs docs/hackathon/web3-iloilo/participant-guide.md`.
- Chromium required execution outside the filesystem sandbox during previous rendering in this environment.
- Renderer keeps pitch/prize sections together; all nine examples fit on page 2 and all pitch instructions on page 5. Pitch timer wording: **At the three-minute mark**.

## Shared starter repository

- Use https://github.com/artisam-paiflow/paiflow-hackathon-starter for both events.
- Published Iloilo context: https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms-web3-iloilo.md . JRU uses `llms.md`. Guide links point to the published Iloilo pack.
- README.md and AGENTS.md select the event context. Shared setup and preparation-mode instructions refer to each event's integration start rather than hardcoding October 14.
- **PR #5 merged** at the user's request: https://github.com/artisam-paiflow/paiflow-hackathon-starter/pull/5 . No merge work remains.
- Pre-merge review found no actionable issues; typecheck, production build and 68 tests passed, and browser assets contained no server credential markers or Stellar secret seeds.

## Latest verification — October 6

Guide/PDF wording, formatting, six-page bounds and example/pitch grouping passed; judging totals 100 points and prizes total PHP 10,000. All seven unique public HTTP links returned 200, and the published context pack matched the event decisions. Funding instructions were checked against Stellar's Freighter testnet guide and Circle's faucet. These are dated checks, not a guarantee of future availability.

## Pending organiser decisions

- Once **Sir Ryan and Sir Mark** have read the proposal, ask them to confirm **start times and durations** for October 16 onboarding and the October 18 hackathon, including the Paiflow integration window. **No outreach has been sent.** Update guide, PDF and local/published context packs after their answers.
- Clarify special-award eligibility: whether placing teams can win special awards, whether one team can win both, and overall/special-award tie-breaking. “Eligible teams” is currently undefined.
- Clarify adapting pre-existing projects and work allowed before onboarding; current rules allow boilerplate/libraries but do not clearly address existing apps.
- Specify how credentials/announcements arrive, how teams report connection problems and how backup demos are arranged.
