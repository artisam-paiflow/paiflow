"use client";

import { useState } from "react";
import { Wand2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FlowGraph } from "@/lib/flows/schema";

type AiGenerateBarProps = {
  onGenerate: (graph: FlowGraph) => void;
};

export default function AiGenerateBar({ onGenerate }: AiGenerateBarProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/flows/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "AI generation failed");
        return;
      }

      onGenerate(data.graph);
      toast.success("Flow generated from your description!");
      setPrompt("");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-lg bg-zinc-900/90 px-3 py-2 ring-1 ring-zinc-800"
    >
      <Wand2 className="text-brand-400 h-4 w-4 shrink-0" />
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g., When I receive USDC, split 50% to Mom and 50% to Savings"
        className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !prompt.trim()}
        className="bg-brand-500 hover:bg-brand-400 shrink-0 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
      </button>
    </form>
  );
}
