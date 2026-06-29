import { OffRampPayoutJobStatus } from "@prisma/client";

const META: Record<OffRampPayoutJobStatus, { label: string; tone: string }> = {
  PENDING: { label: "PENDING", tone: "bg-tertiary/10 text-tertiary border-tertiary/20" },
  RUNNING: { label: "RUNNING", tone: "bg-secondary/10 text-secondary border-secondary/20" },
  QUOTED: { label: "QUOTED", tone: "bg-secondary/10 text-secondary border-secondary/20" },
  INITIATED: { label: "INITIATED", tone: "bg-primary/10 text-primary border-primary/20" },
  COMPLETED: { label: "COMPLETED", tone: "bg-green-500/10 text-green-400 border-green-500/20" },
  FAILED: { label: "FAILED", tone: "bg-error/10 text-error border-error/20" },
  CANCELLED: {
    label: "CANCELLED",
    tone: "bg-surface-variant/30 text-on-surface-variant border-outline/20",
  },
};

export default function OffRampStatusBadge({ status }: { status: OffRampPayoutJobStatus }) {
  const m = META[status];
  return (
    <span className={`text-label-sm inline-block rounded border px-2 py-0.5 font-mono ${m.tone}`}>
      {m.label}
    </span>
  );
}
