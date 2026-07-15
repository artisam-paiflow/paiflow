"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function JudgeCredentials({
  username,
  password,
}: {
  username: string;
  password: string;
}) {
  return (
    <section className="glass-panel mt-md border-tertiary/20 bg-tertiary/5 p-md rounded-xl">
      <div className="text-label-sm text-tertiary flex items-center gap-2 font-mono">
        <span className="material-symbols-outlined text-[14px]">science</span>
        HACKATHON JUDGE ACCESS
      </div>
      <p className="text-body-md text-on-surface-variant mt-3">
        Demo admin account for evaluation. Click a field to copy.
      </p>
      <dl className="mt-md grid grid-cols-[90px_1fr] gap-y-2">
        <dt className="text-label-sm text-on-surface-variant font-mono uppercase">Username</dt>
        <dd>
          <CopyableValue value={username} />
        </dd>
        <dt className="text-label-sm text-on-surface-variant font-mono uppercase">Password</dt>
        <dd>
          <CopyableValue value={password} />
        </dd>
      </dl>
    </section>
  );
}

function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="border-outline-variant/30 bg-surface-container-lowest text-on-surface hover:border-primary/40 hover:text-primary inline-flex w-full items-center justify-between rounded border px-3 py-1.5 font-mono text-[14px] transition-colors"
    >
      <span>{value}</span>
      <span className="material-symbols-outlined text-[14px] opacity-60">
        {copied ? "check" : "content_copy"}
      </span>
    </button>
  );
}
