"use client";

import Link from "next/link";

type Props = {
  flowId: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

export default function DeployButton({ flowId, onClick }: Props) {
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
