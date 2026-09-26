"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ViewportPortal, useReactFlow, useViewport } from "@xyflow/react";
import ConfigPanel from "./config-panel";
import { NODE_TYPE_LABELS } from "@/lib/flows/node-labels";
import { NARROW_VIEWPORT_QUERY, useMediaQuery } from "@/lib/hooks/use-media-query";
import type { FlowNode, FlowGraph } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import type { ValidationIssue } from "@/lib/flows/validate";

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
  chatCollapsed: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  /** Close / Escape. The builder returns focus to the node. */
  onClose: () => void;
  /** Opened from the keyboard: move focus to the heading, never to an input. */
  focusOnOpen: boolean;
  network: StellarNetwork;
  routerContractId?: string;
};

const NODE_ANCHOR_OFFSET_X = 240;

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
  chatCollapsed,
  canvasRef,
  onClose,
  focusOnOpen,
  network,
  routerContractId,
}: CanvasConfigPanelProps) {
  const { getNode, screenToFlowPosition } = useReactFlow();
  const { x, y, zoom } = useViewport();
  // Below md the panel is a sheet docked to the bottom of the screen rather
  // than a card in flow space. It only mounts after a client-side selection,
  // so the server snapshot never renders.
  const docked = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const label = NODE_TYPE_LABELS[node.type];

  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startPanel: { x: number; y: number };
    startPointer: { x: number; y: number };
  } | null>(null);

  const PANEL_WIDTH = 320; // matches w-80
  const PANEL_HEIGHT_ESTIMATE = 360; // conservative visible height before scrolling
  const VIEWPORT_PADDING = 8;

  // Re-anchor the panel next to the newly selected node and keep it inside the
  // visible React Flow viewport. If the default right-side anchor would be
  // clipped, flip the panel to the left side of the node, then clamp to the
  // viewport edges. This re-runs on pan/zoom so the panel stays reachable.
  useEffect(() => {
    if (docked) return;
    const rfNode = getNode(selectedId);
    const container = canvasRef.current;
    if (!rfNode || !container) return;

    const rect = container.getBoundingClientRect();
    const topLeft = screenToFlowPosition({
      x: rect.left + VIEWPORT_PADDING,
      y: rect.top + VIEWPORT_PADDING,
    });
    const bottomRight = screenToFlowPosition({
      x: rect.right - PANEL_WIDTH - VIEWPORT_PADDING,
      y: rect.bottom - PANEL_HEIGHT_ESTIMATE - VIEWPORT_PADDING,
    });

    const rightX = rfNode.position.x + NODE_ANCHOR_OFFSET_X;
    const leftX = rfNode.position.x - PANEL_WIDTH - VIEWPORT_PADDING;

    let nextX = rightX;
    let nextY = rfNode.position.y;

    if (rightX > bottomRight.x && leftX >= topLeft.x) {
      nextX = leftX;
    }

    nextX = Math.max(topLeft.x, Math.min(bottomRight.x, nextX));
    nextY = Math.max(topLeft.y, Math.min(bottomRight.y, nextY));

    setPanelPosition({ x: nextX, y: nextY });
  }, [docked, selectedId, getNode, screenToFlowPosition, x, y, zoom, canvasRef]);

  useEffect(() => {
    if (focusOnOpen) headingRef.current?.focus();
  }, [selectedId, focusOnOpen]);

  // Keep wheel events over the scrollable panel from ever reaching React
  // Flow's d3-zoom listener on the pane: while the cursor is on a scrollable
  // panel, the wheel scrolls only the panel — even at its top/bottom edge,
  // the canvas must not zoom. If the panel is not scrollable at all, the
  // event falls through and zooms the canvas as usual.
  // Must be a native listener: React's synthetic onWheel runs at the root,
  // which is after the pane in the bubble path, so stopPropagation would be
  // too late.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollHeight > el.clientHeight) e.stopPropagation();
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
    // The scroll body remounts when the viewport crosses the breakpoint.
  }, [docked]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pointerFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      dragRef.current = {
        startPanel: panelPosition,
        startPointer: pointerFlow,
      };
    },
    [panelPosition, screenToFlowPosition],
  );

  const onHeaderPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      e.stopPropagation();
      const pointerFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const dx = pointerFlow.x - dragRef.current.startPointer.x;
      const dy = pointerFlow.y - dragRef.current.startPointer.y;
      setPanelPosition({
        x: dragRef.current.startPanel.x + dx,
        y: dragRef.current.startPanel.y + dy,
      });
    },
    [screenToFlowPosition],
  );

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const header = (
    <div
      {...(docked
        ? {}
        : {
            onPointerDown: onHeaderPointerDown,
            onPointerMove: onHeaderPointerMove,
            onPointerUp: onHeaderPointerUp,
          })}
      className={`flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 select-none ${
        docked ? "shrink-0" : "cursor-grab touch-none active:cursor-grabbing"
      }`}
    >
      <div className="flex items-center gap-2">
        {!docked && (
          <span
            aria-hidden
            className="material-symbols-outlined text-[16px] leading-none text-zinc-500"
          >
            drag_indicator
          </span>
        )}
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
    <div
      ref={scrollRef}
      className={`custom-scrollbar overflow-y-auto ${
        docked ? "min-h-0 flex-1 overscroll-contain" : "max-h-[60vh]"
      }`}
    >
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
    // fixed child could not rise above the chat (z-40). Context still flows
    // through the portal, so the React Flow hooks above keep working.
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
    <ViewportPortal>
      <div
        // React Flow raises the selected node to z-index 1000
        // (SELECTED_NODE_Z), so the panel must sit above that to never
        // render behind any node.
        className="z-[10000]"
        style={{
          position: "absolute",
          left: panelPosition.x,
          top: panelPosition.y,
          pointerEvents: "none",
        }}
      >
        {/* The panel lives in flow space, so it pans and zooms together with
            the canvas like a regular node. It owns pointer events so the
            surrounding bounding box does not block the canvas. */}
        <section
          aria-labelledby={headingId}
          data-testid="config-panel-container"
          onKeyDown={onKeyDown}
          className="nopan"
          style={{ pointerEvents: "all" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Chat-shift wrapper: the sidebar is a fixed 268px on screen, so the
              shift must be divided by zoom to stay aligned in flow space. */}
          <div
            className="config-panel-card w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-in-out"
            style={{
              transform: !chatCollapsed ? `translateX(${-268 / zoom}px)` : undefined,
            }}
          >
            {header}
            {body}
          </div>
        </section>
      </div>
    </ViewportPortal>
  );
}
