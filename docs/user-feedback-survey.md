# Paiflow alpha — submission form

> Source of truth for the Google Form that collects tester artifacts. It is a drop-box, not a
> survey: it asks four things and nothing else. Group B uses a second form, which is a survey; its
> spec is [at the end of this page](#group-b--quick-test-survey).

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

---

# Group B — quick-test survey

> Source of truth for the second Google Form, used by the testers who follow
> `alpha-testing-guide-lite.md`. Unlike the form above, this one **is** a survey.

Group B doesn't record a Loom or keep an answers file, so the form is the only place their answers
go. That is why the questions live here and not in the guide — the rule above still holds, there is
just one place. The ratings, the recommend score and the closing questions use **group A's wording
verbatim** (the answers-file template in `alpha-testing-guide.md`), so the two groups can be read
side by side. Don't reword one without the other.

There are no file-upload questions, so the form never forces a Google sign-in. The three
screenshots the guide asks for go in a folder the tester shares, and the form takes its link
(question 30). A Drive folder does need a Google account; any shared folder that opens without
signing in is acceptable instead.

The form was generated from this spec with a one-off Apps Script (`FormApp`), so if a question
changes here, change it in the form by hand as well. It has **six sections**, in this order. The guide sends testers to each section by name, and
B1 has to be answered before they see the app, so don't merge sections. Every question is required
unless marked optional.

## Section 1 — You

**1. Your name** — short answer. Help text: The name we sent your test account to.

## Section 2 — B1: first impression

Description: _Answer from what you saw in those ten seconds. Don't go back to check._

**2. What does Paiflow do?** — paragraph.

**3. Who do you think it is for?** — paragraph.

**4. What would you expect to happen if you clicked the main button?** — paragraph.

## Section 3 — B2: read a flow

**5. When money arrives in this flow, who gets paid, and how much does each get?** — paragraph.
(The answer is 60% Alice, 30% Bob, 10% Charlie, of USDC.)

**6. Where on the screen did you find that out?** — multiple choice: The blocks on the canvas · The
sentence at the top (English Preview) · A block's settings panel · I guessed · Other.

**7. Did you notice the sentence at the top of the builder before this question mentioned it?** —
multiple choice: Yes, I read it · I saw it but didn't read it · No.

## Section 4 — B3: make it yours

**8. Did you get the DEPLOY button to un-grey?** — multiple choice: Yes, without the hint · Yes,
after reading the hint · No.

**9. Roughly how many minutes did it take?** — short answer, number.

**10. Where did you get stuck, or hesitate longest?** — paragraph. Help text: Even if you finished.
"Nowhere" is a fine answer.

**11. Copy the sentence at the top of the builder (English Preview) as it reads now.** — paragraph.
(Expected: _When this contract receives XLM, split XLM — 60% to …, 40% to …._ This is the check that
the flow is right, independent of what they report in question 8.)

**12. On the review page: in your own words, what would pressing DEPLOY TO TESTNET have done?** —
paragraph.

**13. Was there anything on the review page you didn't understand?** — paragraph, optional.

## Section 5 — B4: the customer's side

**14. What is the first page asking you to do?** — paragraph.

**15. If you wanted to pay, would you know what to do next?** — multiple choice: Yes · Not sure ·
No. Follow with **16. What would you need first?** — paragraph, optional.

**17. What does the second page tell you has happened?** — paragraph.

**18. Was anything hard to read or cut off on your phone?** — paragraph, optional. Help text: Tell
us which phone.

## Section 6 — About you and overall

**19. What best describes your role?** — multiple choice: fintech/DeFi founder or PM · software
engineer · SMB operator or finance manager · freelancer/creator · crypto-native user · other.

**20. How comfortable were you with blockchain and smart contracts before today?** — linear scale
1–5 (1 = never used it, 5 = very comfortable).

**21–23. Ratings** — linear scale 1–5 (1 = poor, 5 = excellent):

- How easy was it to understand what Paiflow does at first glance?
- How intuitive was the drag-and-drop canvas?
- How trustworthy does Paiflow feel for real money?

Group A's fourth rating, "How smooth was connecting your wallet and deploying?", is left out: the
core session never connects a wallet.

**24. 0–10, how likely are you to recommend Paiflow to someone who needs programmable payouts?** —
linear scale 0–10. **25. Why that number, and not one higher?** — paragraph.

**26. In your own words, what does Paiflow do? Imagine explaining it to a colleague who's never
seen it.** — paragraph. (Compare with question 2: the distance between the two is what twenty
minutes in the product taught them.)

**27. What should we fix or improve first?** — paragraph.

**28. Was there anything you expected to find and didn't?** — paragraph, optional.

**29. May we follow up with you? If yes, your email.** — short answer, optional.

**30. Link to your screenshots folder** — short answer. Help text: A Google Drive folder shared as
"Anyone with the link can view", containing B1-homepage, B3-review and B4-phone.

## Form settings

| Setting      | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| Title        | Paiflow quick test                                                     |
| Link         | <https://forms.gle/s5D1R8xVnN6X4N338>                                  |
| Description  | Keep this tab open and answer each section when the guide tells you to |
| Sign-in      | Not required — leave "Limit to 1 response" off, since it forces one    |
| Confirmation | Thanks — that's everything. We'll be in touch about your incentive.    |

## What to do with a response

- **Open the screenshots folder before releasing the incentive.** A folder left private is the
  likely failure: ask the tester to fix the sharing, don't withhold over it. Copy the images out,
  since a tester can delete their folder at any time. `B3-review` shows the English Preview
  sentence, so check it against question 11; `B4-phone` is real-device evidence for D3's mobile
  viewport pass. A `B3-review` that shows the builder instead of the review page means they stopped
  short, which the guide allows.
- **There is no recording, so PostHog is the session record.** Match the response to the account
  by name, then read that account's events (`docs/analytics/alpha-tracking-plan.md`, "Group B").
  Question 9 is self-reported; the gap between `builder_opened` and `deploy_review_viewed` is the
  measured version.
- **Question 8 against question 11.** "Yes" with a preview sentence that doesn't say XLM, 60% and
  40% means the tester believed a wrong flow was right — the most valuable kind of finding here.
- **Guided against unguided.** B3 is group A's T4 without the steps. Compare where group B
  hesitated (question 10) with what group A said in the T4 interview box.
- **Pool with group A**: questions 21–24 and 26–28 are the same questions. Group B is fewer than
  ten people, so read the numbers as indications, and keep the two groups labelled when quoting.
- **The bonus** is not part of the form. A tester sends their deployment page link by message; check
  it is ACTIVE and its live feed shows a RECEIVE and two PAYOUT rows, and that `bonus-live-feed` is in
  their folder, before releasing the extra ₱75. The base incentive is **₱125** for a submitted survey and the three screenshots (`alpha-testing-guide-lite.md`).
