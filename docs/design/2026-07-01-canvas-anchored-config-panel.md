# Canvas-anchored, draggable config panel

> **Status: superseded.** Shipped as designed, then reversed between 2026-07-03
> and 2026-07-19. `components/builder/canvas-config-panel.tsx` no longer works
> the way this record describes — read the record for the _why_, and the code
> for the _what_.
>
> | This record says                                                                                      | What shipped instead                                                                                                               |
> | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
> | Goal 1 — remove the height cap and internal scrollbar so the panel renders at its natural full height | `5a127dd` (2026-07-04) "cap config panel height". Today the body is `max-h-[60vh] overflow-y-auto` (`canvas-config-panel.tsx:197`) |
> | Design §2 — the panel stays an overlay sibling of `<ReactFlow>`, **not** inside the transformed pane  | `83096c9` (2026-07-03, two days after this record) "render config panel in ViewportPortal layer". It is now inside the pane        |
> | Design §2 — `onMove` accumulates a `prevViewport` delta into an `offset`                              | Gone. `useViewport()` plus a node-anchored `panelPosition` and `NODE_ANCHOR_OFFSET_X`                                              |
> | Non-goal — the panel does not scale with canvas zoom                                                  | `4d51906` (2026-07-13) "let node config panel zoom with the canvas"                                                                |
> | Non-goal — no drag bounds or snapping in this iteration                                               | `1581f68` (2026-07-19) "keep node config panel inside viewport" — viewport clamping and a left-side flip                           |
>
> Two things survived. **Goal 3**, the draggable header handle, is still there
> (`onHeaderPointerDown` and `cursor-grab` / `active:cursor-grabbing`,
> `canvas-config-panel.tsx:174-177`). And **Goal 2's outcome** — the panel
> follows canvas panning — holds, by the opposite mechanism: it now lives in the
> pane this record said to stay out of.
>
> Nothing below this banner has been edited. A design record is a decision at a
> point in time; rewriting it to agree with the present would destroy the only
> thing it is for. See [`README.md`](./README.md).

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
