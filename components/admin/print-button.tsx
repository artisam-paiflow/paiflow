"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-primary text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-sm font-bold"
    >
      <span className="material-symbols-outlined text-[16px]">print</span>
      PRINT
    </button>
  );
}
