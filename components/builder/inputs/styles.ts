// Shared classes for the builder's shared inputs (BRAND.md §6). Kept as plain
// strings rather than merged through `cn`: tailwind-merge v2 does not know the
// @theme names (`text-label-sm`, `p-xs`), so an override could silently drop
// the wrong class.

/**
 * The control itself. The invalid state keys off `aria-invalid`, which `Field`
 * sets, so no caller wires an error class by hand. 16px text below `md` stops
 * iOS zooming the page on focus; coarse pointers get a 44px target.
 */
export const inputClass = [
  "bg-surface-container-lowest border-outline-variant/50 text-on-surface",
  "w-full rounded border px-3 py-2 font-mono text-[16px] md:text-[14px]",
  "transition-colors focus:outline-none",
  "focus-visible:border-primary focus-visible:ring-primary focus-visible:ring-1",
  "pointer-coarse:min-h-11",
  "aria-invalid:border-error/70 aria-invalid:focus-visible:border-error aria-invalid:focus-visible:ring-error/50",
  "disabled:cursor-not-allowed disabled:opacity-60",
].join(" ");

/** A value the user cannot change, shown in the control's footprint. */
export const readoutClass = [
  "bg-surface-container-lowest border-outline-variant/30 text-on-surface-variant",
  "flex w-full items-center rounded border px-3 py-2 font-mono text-[16px] md:text-[14px]",
  "pointer-coarse:min-h-11",
  "aria-invalid:border-error/70",
].join(" ");

// Neutral, not pink: pink is kept for the focused field (BRAND.md §6).
export const labelClass =
  "text-label-sm text-on-surface-muted group-focus-within:text-primary font-body font-medium";

export const hintClass = "text-label-sm text-on-surface-muted font-body leading-snug";

export const errorClass = "text-label-sm text-error font-mono leading-snug";

/** A unit beside a control (`USDC`, `%`): laid out, not positioned over it. */
export const suffixClass = "text-label-sm text-on-surface-muted shrink-0 font-mono";
