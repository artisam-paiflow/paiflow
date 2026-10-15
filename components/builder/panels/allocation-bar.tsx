import { bpsToPct, TOTAL_BPS, type SplitRecipient } from "@/lib/flows/schema";

export function AllocationBar({ recipients }: { recipients: SplitRecipient[] }) {
  const percentageRecipients = recipients.filter(
    (r): r is Extract<SplitRecipient, { mode: "percentage" }> => r.mode === "percentage",
  );
  const total = percentageRecipients.reduce((s, r) => s + r.bps, 0);
  const colors = [
    "#a78bfa",
    "#34d399",
    "#60a5fa",
    "#fbbf24",
    "#f472b6",
    "#fb923c",
    "#22d3ee",
    "#e879f9",
  ];

  return (
    <div className="grid gap-1">
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        {percentageRecipients.map((r, i) => {
          const w = total > 0 ? (r.bps / total) * 100 : 0;
          if (w <= 0) return null;
          return (
            <div
              key={i}
              className="allocation-bar-segment h-full transition-all duration-200"
              style={{
                width: `${w}%`,
                backgroundColor: colors[i % colors.length]!,
              }}
            />
          );
        })}
        {total < TOTAL_BPS && (
          <div
            className="allocation-bar-segment h-full bg-zinc-700 transition-all duration-200"
            style={{ width: `${((TOTAL_BPS - total) / TOTAL_BPS) * 100}%` }}
          />
        )}
      </div>
      <ul
        aria-label="Recipient allocations"
        className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400"
      >
        {percentageRecipients.map((r, i) => (
          <li key={i} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            {r.label ?? `Recipient ${i + 1}`}: {bpsToPct(r.bps)}%
          </li>
        ))}
      </ul>
    </div>
  );
}
