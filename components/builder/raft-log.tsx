"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Ship, Send, Loader2, Wand2, CheckCircle2, X, AlertTriangle } from "lucide-react";
import { StrKey } from "@stellar/stellar-sdk";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "raft"; content: string; patch?: unknown[] };

interface RaftLogProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  loading?: boolean;
  open: boolean;
  onClose: () => void;
  className?: string;
  pendingAddresses?: string[];
  onResolveAddress?: (addresses: Record<string, string>) => Promise<void>;
  onSkipAddresses?: () => void;
}

const SUGGESTIONS = [
  "Add a recipient",
  "Change asset to XLM",
  "Make Alice 55%",
  "Add a condition",
  "Remove the last node",
];

function patchSummary(patch: unknown[]): string {
  if (!patch.length) return "No changes needed.";
  const counts = new Map<string, number>();
  for (const op of patch) {
    if (typeof op === "object" && op !== null && "op" in op) {
      const key = String((op as Record<string, unknown>).op);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const labels: Record<string, string> = {
    updateNode: "updated",
    addNode: "added",
    removeNode: "removed",
    addEdge: "connected",
    removeEdge: "disconnected",
  };
  const parts = Array.from(counts.entries()).map(([op, n]) => {
    const label = labels[op] ?? op;
    return `${n} ${label} ${n === 1 ? "node" : "nodes"}`;
  });
  return `Applied ${parts.join(", ")}.`;
}

function MissingAddressPrompt({
  labels,
  onResolve,
  onSkip,
  loading,
}: {
  labels: string[];
  onResolve: (addresses: Record<string, string>) => void;
  onSkip?: () => void;
  loading: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(labels.map((l) => [l, ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(label: string, addr: string): string | null {
    if (!addr.trim()) return "Required";
    if (!StrKey.isValidEd25519PublicKey(addr.trim())) return "Invalid Stellar address";
    return null;
  }

  function handleChange(label: string, value: string) {
    setValues((prev) => ({ ...prev, [label]: value }));
    const err = validate(label, value);
    setErrors((prev) => {
      const next = { ...prev };
      if (err) next[label] = err;
      else delete next[label];
      return next;
    });
  }

  function handleSubmit() {
    const newErrors: Record<string, string> = {};
    for (const l of labels) {
      const err = validate(l, values[l] ?? "");
      if (err) newErrors[l] = err;
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;
    onResolve(values);
  }

  const allValid = labels.every((l) => !validate(l, values[l] ?? ""));

  return (
    <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3">
      <div className="flex items-center gap-2 text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs font-semibold">
          {labels.length} recipient{labels.length > 1 ? "s" : ""} need Stellar addresses
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {labels.map((label) => (
          <div key={label}>
            <div className="mb-0.5 text-[11px] font-medium text-zinc-300 capitalize">{label}</div>
            <input
              className={`w-full rounded-md bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-100 ring-1 transition-all outline-none placeholder:text-zinc-600 focus:ring-2 ${
                errors[label]
                  ? "ring-red-700 focus:ring-red-500"
                  : "focus:ring-brand-500 ring-zinc-700"
              }`}
              placeholder="G..."
              value={values[label]}
              onChange={(e) => handleChange(label, e.target.value)}
              disabled={loading}
            />
            {errors[label] && (
              <div className="mt-0.5 text-[10px] text-red-400">{errors[label]}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSkip?.()}
          disabled={loading}
          className="rounded-md px-3 py-1.5 text-xs text-zinc-400 ring-1 ring-zinc-700 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40"
        >
          Skip for now
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading || !allValid}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
        >
          {loading ? "Resolving..." : "Apply Addresses"}
        </button>
      </div>
    </div>
  );
}

export default function RaftLog({
  messages,
  onSend,
  loading,
  open,
  onClose,
  className,
  pendingAddresses,
  onResolveAddress,
  onSkipAddresses,
}: RaftLogProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput("");
  }

  function handleSuggestion(text: string) {
    if (loading) return;
    onSend(text);
    inputRef.current?.focus();
  }

  const isEmpty = messages.length === 0;

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute top-14 right-3 z-20 flex w-80 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="bg-brand-500/20 flex h-6 w-6 items-center justify-center rounded-full">
            <Ship className="text-brand-400 h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-100">Raft Log</div>
            <div className="text-[10px] text-zinc-500">Ask AI to edit your flow</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3" style={{ maxHeight: "380px" }}>
        {isEmpty && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="bg-brand-500/10 flex h-10 w-10 items-center justify-center rounded-full">
              <Wand2 className="text-brand-400 h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium text-zinc-200">
                What would you like to change?
              </div>
              <div className="mt-1 max-w-[240px] text-xs leading-relaxed text-zinc-500">
                Describe edits in plain English. The AI will update your flow automatically.
              </div>
            </div>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400 ring-1 ring-zinc-800 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-brand-600 max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm text-white shadow-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <div className="bg-brand-500/20 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                <Ship className="text-brand-400 h-2.5 w-2.5" />
              </div>
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-tl-sm bg-zinc-900 px-3 py-2 text-sm text-zinc-200 shadow-sm">
                  {m.content}
                </div>
                {m.patch && m.patch.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                    {patchSummary(m.patch)}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex gap-2">
            <div className="bg-brand-500/20 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
              <Ship className="text-brand-400 h-2.5 w-2.5" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-zinc-900 px-3 py-2 text-sm text-zinc-400 shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs">Thinking…</span>
              </div>
            </div>
          </div>
        )}

        {pendingAddresses && pendingAddresses.length > 0 && onResolveAddress && (
          <MissingAddressPrompt
            labels={pendingAddresses}
            onResolve={onResolveAddress}
            onSkip={onSkipAddresses}
            loading={loading ?? false}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 px-2.5 py-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask to edit your flow…"
          disabled={loading}
          className="focus:ring-brand-500 flex-1 rounded-full bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 ring-1 ring-zinc-800 transition-all outline-none placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-brand-600 hover:bg-brand-500 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition-colors disabled:opacity-40"
        >
          <Send className="h-3 w-3" />
        </button>
      </form>
    </div>
  );
}
