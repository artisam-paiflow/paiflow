"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow, useViewport } from "@xyflow/react";
import ConfigPanel from "./config-panel";
import type { FlowNode, FlowGraph } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";

type CanvasConfigPanelProps = {
  selectedId: string;
  node: FlowNode;
  graph: FlowGraph;
  onChange: (n: FlowNode) => void;
  onDelete: (id: string) => void;
  addressBook: AddressEntry[];
  refreshAddressBook: () => void;
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  chatCollapsed: boolean;
  canvasRef: React.RefObject<HTMLDivElement | null>;
};

const NODE_ANCHOR_OFFSET_X = 240;

export default function CanvasConfigPanel({
  selectedId,
  node,
  graph,
  onChange,
  onDelete,
  addressBook,
  refreshAddressBook,
  addressBookLoading,
  addressBookError,
  chatCollapsed,
  canvasRef,
}: CanvasConfigPanelProps) {
  const { getNode, screenToFlowPosition } = useReactFlow();
  const { x, y, zoom } = useViewport();

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
  }, [selectedId, getNode, screenToFlowPosition, x, y, zoom, canvasRef]);

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
  }, []);

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
        <div
          className="nopan"
          style={{ pointerEvents: "all" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Chat-shift wrapper: the sidebar is a fixed 268px on screen, so the
              shift must be divided by zoom to stay aligned in flow space. */}
          <div
            className="w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-in-out"
            style={{
              transform: !chatCollapsed ? `translateX(${-268 / zoom}px)` : undefined,
            }}
          >
            {/* Draggable header */}
            <div
              onPointerDown={onHeaderPointerDown}
              onPointerMove={onHeaderPointerMove}
              onPointerUp={onHeaderPointerUp}
              className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 select-none active:cursor-grabbing"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] leading-none text-zinc-500">
                  drag_indicator
                </span>
                <span className="text-brand-400 text-xs tracking-wider uppercase">
                  {node.type.replace("_", " ")}
                </span>
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onDelete(node.id)}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
              >
                Delete
              </button>
            </div>

            <div ref={scrollRef} className="custom-scrollbar max-h-[60vh] overflow-y-auto">
              <ConfigPanel
                node={node}
                graph={graph}
                onChange={onChange}
                onDelete={onDelete}
                addressBook={addressBook}
                refreshAddressBook={refreshAddressBook}
                addressBookLoading={addressBookLoading}
                addressBookError={addressBookError}
                hideHeader
                className="border-0"
              />
            </div>
          </div>
        </div>
      </div>
    </ViewportPortal>
  );
}
