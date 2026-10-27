"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import ConfigPanel from "./config-panel";
import { NODE_TYPE_LABELS } from "@/lib/flows/node-labels";
import { NARROW_VIEWPORT_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import type { FlowNode, FlowGraph } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import type { ValidationIssue } from "@/lib/flows/validate";
import type { FeatureFlags } from "@/lib/feature-flags";

type CanvasConfigPanelProps = {
  selectedId: string;
  node: FlowNode;
  graph: FlowGraph;
  errors: ValidationIssue[];
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
  addressBook: AddressEntry[];
  refreshAddressBook: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  /** Close / Escape. The builder returns focus to the node. */
  onClose: () => void;
  /** Opened from the keyboard: move focus to the heading, never to an input. */
  focusOnOpen: boolean;
  network: StellarNetwork;
  routerContractId?: string;
  features: FeatureFlags;
  sandbox?: boolean;
};

export default function CanvasConfigPanel({
  selectedId,
  node,
  graph,
  errors,
  onChange,
  onDelete,
  addressBook,
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  onClose,
  focusOnOpen,
  network,
  routerContractId,
  features,
  sandbox,
}: CanvasConfigPanelProps) {
  // Below md the panel is a sheet docked to the bottom of the screen rather
  // than the right side of the builder. It only mounts after a client-side selection,
  // so the server snapshot never renders.
  const docked = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const label = NODE_TYPE_LABELS[node.type];

  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
  }, [selectedId, focusOnOpen]);

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex items-center gap-2">
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          aria-label={`${label} settings`}
          className="text-on-surface text-xs tracking-wider uppercase focus:outline-none focus-visible:underline"
        >
          {label}
        </h2>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onDelete(node.id)}
          className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          Delete
        </button>
        <button
          type="button"
          aria-label={`Close ${label} settings`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          className="inline-flex items-center justify-center rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
        >
          <span aria-hidden className="material-symbols-outlined text-[18px] leading-none">
            close
          </span>
        </button>
      </div>
    </div>
  );

  const body = (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ConfigPanel
        node={node}
        graph={graph}
        errors={errors}
        onChange={onChange}
        onDelete={onDelete}
        addressBook={addressBook}
        refreshAddressBook={refreshAddressBook}
        addressBookLoading={addressBookLoading}
        addressBookError={addressBookError}
        network={network}
        routerContractId={routerContractId}
        features={features}
        sandbox={sandbox}
        hideHeader
        className="border-0"
      />
    </div>
  );

  // Escape lives on the panel, not on window: the validation modal owns the
  // global Escape, and an open AddressPicker listbox preventDefaults its own.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  };

  if (docked) {
    // Portalled to <body>: React Flow's wrapper is a stacking context, so a
    // fixed child could not rise above the chat (z-40).
    return createPortal(
      <section
        aria-labelledby={headingId}
        data-testid="config-panel-container"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="nopan fixed inset-x-0 bottom-0 z-[45] flex max-h-[60dvh] flex-col overflow-hidden rounded-t-xl border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)] shadow-2xl"
      >
        {header}
        {body}
      </section>,
      document.body,
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="config-panel-container"
      onKeyDown={onKeyDown}
      className="config-panel-card fixed top-16 right-0 z-[45] flex h-[calc(100dvh-4rem)] min-h-0 w-[420px] max-w-[50vw] flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      {header}
      {body}
    </section>
  );
}
