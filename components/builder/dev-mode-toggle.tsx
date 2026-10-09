"use client";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/client";

export default function DevModeToggle({
  enabled,
  value,
  onChange,
}: {
  enabled: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <>
      {enabled && (
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Dev mode"
          onClick={() => {
            if (!value) track("off_script_feature_used", { feature: "dev_mode_on" });
            onChange(!value);
          }}
          title={
            value
              ? "Dev mode ON — pay / split / subscription nodes deploy as mutable variants you fill via the API"
              : "Dev mode OFF — recipients and amounts are fixed at design time"
          }
          className={cn(
            "text-label-sm inline-flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors max-md:px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            value
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant hover:text-on-surface",
          )}
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            {value ? "toggle_on" : "toggle_off"}
          </span>
          <span className="max-md:sr-only">Dev mode</span>
        </button>
      )}
    </>
  );
}
