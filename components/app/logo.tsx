type LogoProps = {
  /** Pixel size of the square mark. Wordmark scales the mark to this height. */
  size?: number;
  /** Show "Paiflow" wordmark next to the mark. */
  wordmark?: boolean;
  className?: string;
};

/**
 * Paiflow logo. Three chevrons cascading diagonally — trigger → logic →
 * action. Stroked in BRAND `primary` (#ffb1c4) with opacity falloff on the
 * back chevrons to suggest depth. Wordmark in BRAND display font.
 */
export default function Logo({ size = 28, wordmark = true, className = "" }: LogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6,7 10,11 6,15" />
        <polyline points="13,11 17,15 13,19" opacity="0.78" />
        <polyline points="20,15 24,19 20,23" opacity="0.55" />
      </g>
    </svg>
  );

  if (!wordmark) {
    return <span className={`text-primary ${className}`}>{mark}</span>;
  }

  return (
    <span className={`text-primary inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span className="font-display text-on-surface text-[18px] leading-none font-bold tracking-tight">
        Paiflow
      </span>
    </span>
  );
}
