"use client";

import Link from "next/link";

export default function DeployButton({ flowId }: { flowId: string }) {
  return (
    <Link
      href={`/flows/${flowId}/deploy`}
      className="bg-brand-600 hover:bg-brand-500 rounded px-4 py-1.5 text-sm font-semibold"
    >
      Deploy
    </Link>
  );
}
