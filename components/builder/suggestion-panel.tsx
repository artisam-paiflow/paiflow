"use client";

import { useState } from "react";
import { Sparkles, X, AlertCircle, AlertTriangle, Info } from "lucide-react";

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

function severityIcon(severity: Suggestion["severity"]) {
  switch (severity) {
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-400" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "info":
      return <Info className="h-4 w-4 text-sky-400" />;
  }
}

function severityBorder(severity: Suggestion["severity"]) {
  switch (severity) {
    case "error":
      return "border-l-red-400";
    case "warning":
      return "border-l-amber-400";
    case "info":
      return "border-l-sky-400";
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
      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={onReview}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="text-brand-400 h-4 w-4" />
          Ask AI to Review
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800">
      <div
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium text-zinc-300 hover:text-zinc-100"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <Sparkles className="text-brand-400 h-4 w-4" />
          AI Suggestions
          {suggestions.length > 0 && (
            <span className="bg-brand-500 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">
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
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              title="Dismiss all"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <span className="text-xs text-zinc-500">{expanded ? "−" : "+"}</span>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {loading && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">
              <Sparkles className="text-brand-400 h-3.5 w-3.5 animate-pulse" />
              Analyzing flow...
            </div>
          )}
          {suggestions.map((s, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-r-lg border-l-2 ${severityBorder(s.severity)} bg-zinc-900/50 px-3 py-2 text-xs text-zinc-300`}
            >
              {severityIcon(s.severity)}
              <span className="flex-1 leading-relaxed">{s.message}</span>
              <button
                onClick={() => onDismiss(i)}
                className="mt-0.5 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {!loading && (
            <button
              onClick={onReview}
              className="mt-1 w-full rounded bg-zinc-900 py-1.5 text-xs font-medium text-zinc-400 ring-1 ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Re-review
            </button>
          )}
        </div>
      )}
    </div>
  );
}
