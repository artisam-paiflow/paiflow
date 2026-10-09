"use client";

import type { ReactNode } from "react";

export default function PaletteSidebar({
  children,
  onOpenChange,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div
      className="min-h-0 min-w-0"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={(event) => {
        // Keep keyboard navigation intact when the pointer moves to the canvas.
        if (!event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)) {
          onOpenChange(false);
        }
      }}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !event.currentTarget.matches(":hover")
        ) {
          onOpenChange(false);
        }
      }}
    >
      {children}
    </div>
  );
}
