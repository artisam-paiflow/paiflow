-- Evidence for future observations only; no historical outcomes or events are rewritten.
ALTER TABLE "SignedTransaction"
  ADD COLUMN "submissionRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outcomeRevision" INTEGER NOT NULL DEFAULT 0;
