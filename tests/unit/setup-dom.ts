// Setup for the `dom` vitest project only, run after tests/unit/setup.ts.
//
// Testing Library registers its own afterEach(cleanup) only when vitest
// globals are on, and this repo runs with `globals: false`, so rendered trees
// would otherwise leak from one case into the next.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Tells React 19 this is a test environment, so state updates outside act()
// warn instead of passing unnoticed.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas and prints "Not implemented: getContext()" when axe-core's
// colour-contrast rule probes for one. Returning null is what jsdom does
// anyway, minus the console noise; contrast is not decidable here regardless.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
});
