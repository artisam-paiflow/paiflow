# Canvas-anchored, draggable config panel

**Issue:** #259 (node config modal overflow) — replacing the internal-scrollbar fix.
**Date:** 2026-07-01
**Branch:** `fix-259-node-config-modal-overflow`

## Problem

A tall node config panel (e.g. a splitter with many recipients) exceeds the
viewport height. The current 259 fix caps the panel height and gives it an
internal scrollbar, which the user dislikes. We want the full panel visible by
moving it (via canvas pan or direct drag) rather than scrolling inside it.

## Goals

1. Remove the internal scrollbar / height cap so the panel renders at its
   natural full height.
2. Make the panel move together with the canvas when the canvas is panned, so
   dragging the canvas brings clipped parts of the panel into view.
3. Make the panel independently draggable by a dedicated header handle.

## Non-goals

- The panel does **not** scale with canvas zoom — it stays a fixed, readable
  size (pan only).
- No drag bounds / snapping in this iteration.

## Design

### 1. Remove scroll/clip caps

- `components/builder/config-panel.tsx`: remove `max-h-[calc(100vh-160px)]` and
  `overflow-y-auto` from the `<aside>` root so it grows to content height.
- `components/builder/builder-client.tsx`: the floating wrapper around
  `<ConfigPanel>` drops `max-h-[calc(100vh-160px)]` and `overflow-hidden` so it
  no longer clips a tall panel.

### 2. Follow canvas panning

- The panel stays an overlay sibling of `<ReactFlow>` (not inside the
  transformed pane) — this avoids React Flow intercepting form input and avoids
  zoom scaling.
- Wrapper gets an `offset = {x, y}` state applied as `transform: translate(...)`,
  starting at `{0, 0}`.
- React Flow `onMove(_, viewport)` adds the viewport translation **delta**
  (tracked via a `prevViewport` ref) to `offset` on every pan tick, so the panel
  glides 1:1 with the pane.
- `offset` resets to `{0, 0}` whenever the selected node id changes, re-anchoring
  the panel to its default top-right position for each newly opened node.

### 3. Draggable header handle

- A dedicated header strip at the top of the wrapper: grip affordance + node
  title, `cursor-grab`/`cursor-grabbing`.
- The existing node-type label + Delete button move into this header;
  `ConfigPanel` takes a prop to suppress its own internal header row so the title
  isn't duplicated.
- `onPointerDown` on the header captures the pointer; `pointermove` adds movement
  to the same `offset`. Pan-follow and manual drag compose through one offset.

### 4. Details

- Wrapper `transition-all duration-300` → `transition-[right]` so only the
  chat-open horizontal shift animates; live pan/drag translate stays instant.
- Dragging a node does not move the panel (node drag doesn't change the
  viewport, so `onMove` doesn't fire).

## Verification

Manual/preview verification (drag interactions are impractical to unit test):
open a flow, select a tall node (splitter), confirm no internal scrollbar, pan
the canvas and confirm the panel moves with it, drag the header and confirm the
panel repositions, switch nodes and confirm it re-anchors.
