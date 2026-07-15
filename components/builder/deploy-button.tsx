"use client";

import Link from "next/link";

type Props = {
  flowId: string;
  disabled?: boolean;
  errorCount?: number;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

export default function DeployButton({ flowId, disabled = false, errorCount = 0, onClick }: Props) {
  const label =
    errorCount === 1
      ? "1 validation error must be resolved before deploying"
      : `${errorCount} validation errors must be resolved before deploying`;

  if (disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        title={label}
        className="text-label-md bg-surface-container-high text-on-surface-variant/60 inline-flex cursor-not-allowed items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold"
      >
        <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
        DEPLOY
      </span>
    );
  }

  return (
    <Link
      href={`/flows/${flowId}/deploy`}
      onClick={onClick}
      className="group bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.6)] active:scale-95"
    >
      <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
      DEPLOY
    </Link>
  );
}
