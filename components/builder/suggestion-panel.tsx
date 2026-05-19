"use client";

import { useState } from "react";

type Suggestion = {
  severity: "error" | "warning" | "info";
  message: string;
};

type SuggestionPanelProps = {
  suggestions: Suggestion[];
  loading: boolean;
  onReview: () => void;
  onDismiss: (index: number) => void;
  onDismissAll: () => void;
};

function severityMeta(severity: Suggestion["severity"]) {
  switch (severity) {
    case "error":
      return { icon: "error", border: "border-l-error", tone: "text-error" };
    case "warning":
      return { icon: "warning", border: "border-l-tertiary", tone: "text-tertiary" };
    case "info":
      return { icon: "info", border: "border-l-secondary", tone: "text-secondary" };
  }
}

export default function SuggestionPanel({
  suggestions,
  loading,
  onReview,
  onDismiss,
  onDismissAll,
}: SuggestionPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (!suggestions.length && !loading) {
    return (
      <div className="border-outline-variant/15 border-t p-3">
        <button
          onClick={onReview}
          disabled={loading}
          className="border-outline-variant/40 bg-surface-container-low/50 text-label-md text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high/40 hover:text-on-surface flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-primary text-[14px]">auto_awesome</span>
          ASK AI TO REVIEW
        </button>
      </div>
    );
  }

  return (
    <div className="border-outline-variant/15 border-t">
      <div
        className="px-md text-label-md text-on-surface-variant hover:text-on-surface flex w-full cursor-pointer items-center justify-between py-2.5 font-mono transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[14px]">auto_awesome</span>
          AI SUGGESTIONS
          {suggestions.length > 0 && (
            <span className="bg-primary text-on-primary rounded-full px-1.5 py-0.5 text-[10px] font-bold">
              {suggestions.length}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {suggestions.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismissAll();
              }}
              className="text-on-surface-variant hover:bg-surface-container-high/40 hover:text-on-surface rounded p-1 transition-colors"
              title="Dismiss all"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
          <span className="text-label-sm text-on-surface-variant font-mono">
            {expanded ? "−" : "+"}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-md pb-md space-y-2">
          {loading && (
            <div className="bg-surface-container-low/40 text-label-sm text-on-surface-variant flex items-center gap-2 rounded-lg px-3 py-2 font-mono">
              <span className="material-symbols-outlined text-primary animate-pulse text-[14px]">
                auto_awesome
              </span>
              ANALYZING FLOW…
            </div>
          )}
          {suggestions.map((s, i) => {
            const m = severityMeta(s.severity);
            return (
              <div
                key={i}
                className={`flex items-start gap-2 rounded-r-lg border-l-2 ${m.border} bg-surface-container-low/40 text-body-md text-on-surface px-3 py-2`}
              >
                <span className={`material-symbols-outlined mt-0.5 text-[14px] ${m.tone}`}>
                  {m.icon}
                </span>
                <span className="flex-1 leading-relaxed">{s.message}</span>
                <button
                  onClick={() => onDismiss(i)}
                  className="text-on-surface-variant hover:bg-surface-container-high/40 hover:text-on-surface mt-0.5 rounded p-0.5 transition-colors"
                  title="Dismiss"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            );
          })}
          {!loading && (
            <button
              onClick={onReview}
              className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface mt-1 w-full rounded-lg border py-1.5 font-mono transition-colors"
            >
              RE-REVIEW
            </button>
          )}
        </div>
      )}
    </div>
  );
}
