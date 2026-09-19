# Paiflow alpha — submission form

> Source of truth for the Google Form that collects tester artifacts. It is a drop-box, not a
> survey: it asks four things and nothing else.

The questions this form used to ask — role, ratings, NPS, open feedback — now live in
`alpha-testing-guide.md` as interview questions. Testers answer them out loud on their recording
and in writing in an answers file, which they upload here. Don't re-add them to the form; two
places to answer the same question is how the two drift apart.

Testers are told to submit only after finishing T7 and the closing questions, so a submission is
expected to be complete. All four fields are required — a missing artifact means the **₱650**
incentive isn't released (`alpha-testing-guide.md` §8.2).

---

## Fields

**1. Your name**

- Short answer, **required**
- Help text: The name we sent your test account to, so we can match your submission to it.

**2. Your Loom recording URL**

- **Paragraph**, **required**
- Help text: One link covering T1–T7. If you recorded in parts, paste every link, one per line.
  Make sure the share setting allows anyone with the link to view.
- Paragraph rather than short answer on purpose: the guide permits several links, and a short
  answer is single-line. Don't add URL response-validation either — it rejects a multi-line value.

**3. Your screenshots**

- File upload, **required**
- Max **1 file**, up to 100 MB — the named screenshots from the testing guide, zipped into a single
  archive. Forms caps a question at 10 files, and a full run produces about 30.
- Leave **"Allow only specific file types" off**. Google's presets are Document / Spreadsheet /
  PDF / Image / Video / Presentation / Drawing / Audio — ZIP is not among them, so switching the
  restriction on rejects exactly the file we're asking for.

**4. Your interview answers**

- File upload, **required**
- Max **1 file**, up to 10 MB. `.txt` or a doc — the template is the appendix of the testing guide.

---

## Form settings

| Setting      | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| Title        | Paiflow alpha — submission                                               |
| Description  | Send in your recording, screenshots and answers. All three are required. |
| Required     | All four fields                                                          |
| Confirmation | Thanks — that's everything. We'll be in touch about your incentive.      |

Two things to know before building it:

- **A file-upload question forces every respondent to sign in with a Google account.** Forms gives
  no way to disable that, and uploads land in the form owner's Drive, so check quota before the
  round starts.
- **If this form is owned by a Google Workspace account**, file uploads can be restricted for
  respondents outside the organisation. Submit a test response from a personal Gmail before sending
  the guide out.

## What to do with a submission

- The Loom is the only record of the session: **session replay is off**
  (`docs/analytics/alpha-tracking-plan.md`). Pair it with that tester's PostHog event funnel — the
  recording shows what they intended, the events show what the app actually did.
- The answers file carries the quantitative bits that used to be form questions: four 1–5 ratings
  and a 0–10 recommend score. Pull those into a sheet by hand; the sample is small enough.
- **NPS** from the 0–10: promoters 9–10, passives 7–8, detractors 0–6.
- **Trust gaps** from closing questions 2 and 5.
- **Top priority** from closing question 5 across all testers.
