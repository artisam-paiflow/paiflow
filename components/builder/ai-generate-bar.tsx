"use client";

import { useState, useEffect } from "react";
import { Wand2, Loader2, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { FlowGraph } from "@/lib/flows/schema";

type PreviewState =
  | { status: "idle" }
  | { status: "loading"; prompt: string }
  | {
      status: "preview";
      graph: FlowGraph;
      english: string;
      warnings: string[];
    }
  | {
      status: "error";
      error: string;
      guidance?: string;
    };

type AiGenerateBarProps = {
  onGenerate: (graph: FlowGraph) => void;
};

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", desc: "Smarter" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", desc: "Faster" },
] as const;

const MODEL_STORAGE_KEY = "pinkraft-ai-model";

function collectWarnings(graph: FlowGraph): string[] {
  const warnings: string[] = [];
  for (const node of graph.nodes) {
    if (node.type === "pay") {
      warnings.push("Recipient address is a placeholder — replace before deploying.");
    }
    if (node.type === "split") {
      const hasPlaceholder = node.config.recipients.some((r) =>
        r.address.startsWith("GAO5RJ6BZJY5DZISYWNS3AOPET4J6PJT6EAEOYDWAY6YRWCQ6VH4OSYB"),
      );
      if (hasPlaceholder) {
        warnings.push("Recipient addresses are placeholders — replace before deploying.");
      }
    }
  }
  return [...new Set(warnings)];
}

export default function AiGenerateBar({ onGenerate }: AiGenerateBarProps) {
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [model, setModel] = useState<string>(MODELS[0].id);

  // Load saved model preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) setModel(saved);
    } catch {
      // ignore
    }
  }, []);

  // Persist model preference
  useEffect(() => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, model);
    } catch {
      // ignore
    }
  }, [model]);

  async function handleSubmit(e?: React.FormEvent, overridePrompt?: string) {
    if (e) e.preventDefault();
    const p = (overridePrompt ?? prompt).trim();
    if (!p) return;

    setPreview({ status: "loading", prompt: p });

    try {
      const res = await fetch("/api/flows/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: p, model }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPreview({
          status: "error",
          error: typeof data.error === "string" ? data.error : "AI generation failed",
          guidance: typeof data.guidance === "string" ? data.guidance : undefined,
        });
        return;
      }

      const warnings = collectWarnings(data.graph);
      setPreview({
        status: "preview",
        graph: data.graph,
        english: data.english,
        warnings,
      });
    } catch {
      setPreview({
        status: "error",
        error: "Network error. Please check your connection and try again.",
      });
    }
  }

  function applyGraph() {
    if (preview.status !== "preview") return;
    onGenerate(preview.graph);
    toast.success("Flow applied to canvas!");
    setPreview({ status: "idle" });
    setPrompt("");
  }

  function cancel() {
    setPreview({ status: "idle" });
  }

  if (preview.status === "preview") {
    return (
      <div className="space-y-2 rounded-lg bg-zinc-900/90 px-3 py-2 ring-1 ring-zinc-800">
        <div className="flex items-center gap-2">
          <Wand2 className="text-brand-400 h-4 w-4 shrink-0" />
          <span className="text-brand-400 text-xs font-medium">AI Preview</span>
          <span className="ml-auto text-[10px] text-zinc-500">
            {MODELS.find((m) => m.id === model)?.label ?? model}
          </span>
        </div>
        <div className="rounded bg-zinc-950/50 px-3 py-2 text-sm text-zinc-200">
          {preview.english}
        </div>
        {preview.warnings.length > 0 && (
          <div className="space-y-1">
            {preview.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={applyGraph}
            className="bg-brand-500 hover:bg-brand-400 flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            <Check className="h-3.5 w-3.5" />
            Apply to Canvas
          </button>
          <button
            onClick={cancel}
            className="flex items-center justify-center gap-1.5 rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (preview.status === "error") {
    return (
      <div className="space-y-2 rounded-lg bg-zinc-900/90 px-3 py-2 ring-1 ring-red-900/50">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-xs font-medium text-red-400">Couldn&apos;t generate flow</span>
        </div>
        <p className="text-sm text-zinc-300">{preview.error}</p>
        {preview.guidance && <p className="text-xs text-zinc-400">{preview.guidance}</p>}
        <button
          onClick={cancel}
          className="w-full rounded bg-zinc-800 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 rounded-lg bg-zinc-900/90 px-3 py-2 ring-1 ring-zinc-800"
      >
        <div className="flex shrink-0 items-center gap-1">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                model === m.id
                  ? "bg-brand-500 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
              title={m.desc}
            >
              {m.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your payment flow..."
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          disabled={preview.status === "loading"}
        />
        <button
          type="submit"
          disabled={preview.status === "loading" || !prompt.trim()}
          className="bg-brand-500 hover:bg-brand-400 shrink-0 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preview.status === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Generate"
          )}
        </button>
      </form>
    </div>
  );
}
