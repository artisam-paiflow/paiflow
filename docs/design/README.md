# Design records

Why a decision was made, for the cases where the code shows _what_ it does but not
_why_ it does it that way. One file per decision.

## When to write one

When a change turned on a judgement call a reader cannot recover from the diff: a
tradeoff between two workable designs, a constraint that ruled out the obvious
approach, or something tried and abandoned. Routine work does not need one.

## Filename

`YYYY-MM-DD-kebab-title.md`, dated by the decision rather than the merge.

## Shape

Problem / Goals / Non-goals / Design / Verification.
[`2026-07-01-canvas-anchored-config-panel.md`](./2026-07-01-canvas-anchored-config-panel.md)
is the template. **Non-goals** earns its place — it is where you record what you
decided not to do, which is otherwise the first thing a future reader
re-litigates.

## The status rule

**State the decision and its date. Never assert that current code implements it.**

`Status: shipped. Implemented in <file>` is a claim about the present tense, and
it is the sentence that goes stale. The canvas-config-panel record carried
exactly that line, and every decision under it was reversed within three weeks —
its central design point was overturned _two days_ after it was written, while
the banner went on saying the code implemented it.

When a decision is later reversed:

- add a **Superseded** block at the top, naming what replaced it and the commit
  that did it;
- **do not edit the decision itself.** A record rewritten to agree with the
  present is no longer a record;
- **do not delete it.** The reasoning is why the next person does not repeat the
  experiment.

A superseded record stays here. It is still a design record.

## Here or `../archive/`?

- **`design/`** — a decision at a point in time. Allowed to disagree with the
  code, provided its status block says so.
- **[`../archive/`](../archive/)** — a document that set out to describe the
  current system and stopped being true (a feature log, superseded marketing
  copy), or that never described this repo at all.

The test is what the document was _for_. A design record was never a description
of the system, so it does not become wrong when the system changes — only its
status line does.
