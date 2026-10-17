# Builder canvas

Loaded when working under `components/builder/`. The root [`CLAUDE.md`](../../CLAUDE.md) §15 has the
app-wide UX rules.

## Keyboard access

Arrows move the selected node, Delete removes it, Enter or Space on a focused node opens its config
panel and moves focus to the panel's heading (a click opens it without taking focus), and Escape or
the panel's Close button shuts it and returns focus to the node. A "Skip to canvas" button, the
first stop after the app header, focuses the first node, and a focused node or edge shows a
primary-coloured ring (`app/globals.css`).

## Settings layout

On desktop, node settings overlay the right side from below the app header to the bottom of the
viewport, covering the English preview like AI chat. The panel has a fixed header and one scrollable
body, independent of canvas zoom. Settings and AI chat open one at a time. Clicking blank canvas
closes settings without moving focus back to the node.

## Below 768px

The panel is a bottom sheet rather than the desktop right panel, the header is one row, the English
preview collapses behind a toggle (its error count stays visible), Ask AI is a bottom-right button,
and the MiniMap is hidden.

## Testing

Test the extracted component, **never `ConfigPanel`** — see [`tests/CLAUDE.md`](../../tests/CLAUDE.md).
