"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  english: string;
  showValidBadge: boolean;
  hasFiatPayout: boolean;
  hasSenderKyc: boolean;
  devMode: boolean;
  errorCount: number;
  onOpenKyc: () => void;
  onOpenErrors: () => void;
};

export default function EnglishPreview({
  english,
  showValidBadge,
  hasFiatPayout,
  hasSenderKyc,
  devMode,
  errorCount,
  onOpenKyc,
  onOpenErrors,
}: Props) {
  // Phones only: the sentence starts hidden so the canvas gets the screen.
  // The label row, and with it the error count, stays visible either way.
  const [open, setOpen] = useState(false);
  const textId = useId();
  const showErrors = errorCount > 0;

  return (
    <div className="px-md pb-2 max-md:px-3 max-md:pb-1">
      <div className="glass-panel px-md py-sm max-w-2xl rounded-xl max-md:px-3 max-md:py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-label-sm text-primary font-mono tracking-[0.08em] uppercase">
            English Preview
          </div>
          {showValidBadge && (
            <span className="bg-primary/10 border-primary/20 text-primary text-label-sm inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono">
              valid pipeline
            </span>
          )}
          {hasFiatPayout && (
            <button
              type="button"
              onClick={onOpenKyc}
              title={
                hasSenderKyc
                  ? "Sender KYC on file — click to edit"
                  : devMode
                    ? "Sender KYC is optional in dev mode (can be submitted via the API after deploy)"
                    : "Sender KYC is required before deploying a flow with fiat payouts"
              }
              className={cn(
                "text-label-sm ml-auto inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 font-mono transition-colors",
                hasSenderKyc
                  ? "border-green-500/40 bg-green-500/10 text-green-400"
                  : devMode
                    ? "border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant hover:text-on-surface"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-400",
              )}
            >
              <span className="material-symbols-outlined text-[16px]">
                {hasSenderKyc ? "verified_user" : "warning"}
              </span>
              Sender KYC
            </button>
          )}
          {showErrors && (
            // The live region wraps the button: role="alert" on the button
            // itself would replace its button role for assistive tech.
            <span role="alert" className={cn("inline-flex", !hasFiatPayout && "ml-auto")}>
              <button
                type="button"
                onClick={onOpenErrors}
                aria-label={`View all ${errorCount} validation ${errorCount === 1 ? "issue" : "issues"}`}
                className="bg-error-container/25 border-error/40 text-on-error-container hover:bg-error/10 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 transition-colors"
              >
                <span className="material-symbols-outlined text-error text-[16px] leading-none">
                  error
                </span>
                <span className="text-label-sm text-error font-semibold">
                  {errorCount} {errorCount === 1 ? "Error" : "Errors"}
                </span>
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={textId}
            aria-label={open ? "Hide English preview" : "Show English preview"}
            className={cn(
              "text-on-surface-variant hover:text-on-surface inline-flex items-center justify-center rounded-lg md:hidden pointer-coarse:-my-2.5 pointer-coarse:-mr-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              !hasFiatPayout && !showErrors && "ml-auto",
            )}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[20px] leading-none">
              {open ? "expand_less" : "expand_more"}
            </span>
          </button>
        </div>
        <div
          id={textId}
          data-testid="english-preview-text"
          className={cn(
            "text-body-md text-on-surface mt-1 line-clamp-2",
            open ? "max-md:line-clamp-none" : "max-md:hidden",
          )}
        >
          {english}
        </div>
      </div>
    </div>
  );
}
