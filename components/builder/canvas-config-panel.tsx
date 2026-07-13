"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow, useViewport } from "@xyflow/react";
import { cn } from "@/lib/utils";
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
}: CanvasConfigPanelProps) {
  const { getNode, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();

  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startPanel: { x: number; y: number };
    startPointer: { x: number; y: number };
  } | null>(null);

  // Re-anchor the panel next to the newly selected node. This only runs when the
  // selected id changes, so dragging a node on the canvas does not drag the panel.
  useEffect(() => {
    const rfNode = getNode(selectedId);
    if (!rfNode) return;
    setPanelPosition({
      x: rfNode.position.x + NODE_ANCHOR_OFFSET_X,
      y: rfNode.position.y,
    });
  }, [selectedId, getNode]);

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
        {/* Counter-scale wrapper: cancels the viewport zoom so the panel stays
            a fixed readable size. It owns pointer events so the surrounding
            unscaled bounding box does not block the canvas. */}
        <div
          className="nopan"
          style={{
            transform: `scale(${1 / zoom})`,
            transformOrigin: "top left",
            pointerEvents: "all",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Chat-shift wrapper: lives in the counter-scaled (screen-pixel)
              space so the -268px shift is independent of zoom. */}
          <div
            className={cn(
              "w-80 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 ease-in-out",
              !chatCollapsed && "-translate-x-[268px]",
            )}
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

            <div className="custom-scrollbar max-h-[60vh] overflow-y-auto">
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
