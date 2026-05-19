"use client";

import { useState, useEffect } from "react";
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved && MODELS.some((m) => m.id === saved)) setModel(saved);
    } catch {
      // ignore
    }
  }, []);

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

      if (!res.ok || data.error) {
        setPreview({
          status: "error",
          error: data.error?.message ?? "AI generation failed",
          guidance: data.error?.guidance,
        });
        return;
      }

      const payload = data.data;
      const warnings = collectWarnings(payload.graph);
      setPreview({
        status: "preview",
        graph: payload.graph,
        english: payload.english,
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
    toast.success("Flow applied to canvas.");
    setPreview({ status: "idle" });
    setPrompt("");
  }

  function cancel() {
    setPreview({ status: "idle" });
  }

  if (preview.status === "preview") {
    return (
      <div className="glass-panel space-y-sm px-md py-sm rounded-xl">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[14px]">auto_awesome</span>
          <span className="text-label-sm text-primary font-mono">AI PREVIEW</span>
          <span className="text-label-sm text-on-surface-variant ml-auto font-mono">
            {MODELS.find((m) => m.id === model)?.label ?? model}
          </span>
        </div>
        <div className="border-outline-variant/20 bg-surface-container-lowest/60 text-body-md text-on-surface rounded border px-3 py-2">
          {preview.english}
        </div>
        {preview.warnings.length > 0 && (
          <div className="space-y-1">
            {preview.warnings.map((w, i) => (
              <div
                key={i}
                className="text-label-sm text-tertiary flex items-start gap-1.5 font-mono"
              >
                <span className="material-symbols-outlined mt-0.5 text-[14px]">warning</span>
                {w}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={applyGraph}
            className="bg-primary text-label-md text-on-primary flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95"
          >
            <span className="material-symbols-outlined text-[14px]">check</span>
            APPLY TO CANVAS
          </button>
          <button
            onClick={cancel}
            className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-error/40 hover:text-error flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  if (preview.status === "error") {
    return (
      <div className="glass-panel space-y-sm border-error/40 px-md py-sm rounded-xl">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-error text-[14px]">error</span>
          <span className="text-label-sm text-error font-mono">COULDN’T GENERATE</span>
        </div>
        <p className="text-body-md text-on-surface">{preview.error}</p>
        {preview.guidance && (
          <p className="text-label-sm text-on-surface-variant font-mono">{preview.guidance}</p>
        )}
        <button
          onClick={cancel}
          className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface w-full rounded-lg border py-2 font-mono transition-colors"
        >
          TRY AGAIN
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-panel flex items-center gap-2 rounded-xl px-3 py-2"
    >
      <div className="flex shrink-0 items-center gap-1">
        {MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setModel(m.id)}
            className={`text-label-sm rounded px-2 py-1 font-mono transition-colors ${
              model === m.id
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low/60 text-on-surface-variant hover:text-on-surface"
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
        placeholder="DESCRIBE YOUR PAYMENT FLOW…"
        className="text-on-surface placeholder:text-outline-variant min-w-0 flex-1 bg-transparent font-mono text-[13px] tracking-[0.04em] uppercase focus:outline-none"
        disabled={preview.status === "loading"}
      />
      <button
        type="submit"
        disabled={preview.status === "loading" || !prompt.trim()}
        className="bg-primary text-label-sm text-on-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {preview.status === "loading" ? (
          <span className="material-symbols-outlined animate-spin text-[14px]">
            progress_activity
          </span>
        ) : (
          <>
            <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
            GENERATE
          </>
        )}
      </button>
    </form>
  );
}
