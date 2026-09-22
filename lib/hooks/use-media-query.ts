"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Below `md`: the builder collapses its sidebar and docks the config panel. */
export const NARROW_VIEWPORT_QUERY = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
