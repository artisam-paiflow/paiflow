"use client";
import { useEffect, useState } from "react";
import type { Asset } from "@/lib/flows/schema";
import { assetToParam, type SoroswapQuote } from "@/lib/soroswap/quote";

export type SoroswapQuoteInput = {
  assetIn: Asset;
  assetOut: Asset;
  amountStroops: string;
  slippageBps: number;
};

export type SoroswapQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; quote: SoroswapQuote }
  | { status: "error"; message: string };

/**
 * Debounced live quote from `/api/soroswap/quote` for the swap preview
 * (Instawards D1, #391). Re-fetches when any input changes; aborts the
 * in-flight request on change or unmount.
 */
export function useSoroswapQuote(
  input: SoroswapQuoteInput | null,
  debounceMs = 400,
): SoroswapQuoteState {
  const [state, setState] = useState<SoroswapQuoteState>({ status: "idle" });
  const key = input
    ? `${assetToParam(input.assetIn)}|${assetToParam(input.assetOut)}|${input.amountStroops}|${input.slippageBps}`
    : null;

  useEffect(() => {
    if (!key || !input) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(async () => {
      const qs = new URLSearchParams({
        assetIn: assetToParam(input.assetIn),
        assetOut: assetToParam(input.assetOut),
        amountStroops: input.amountStroops,
        slippageBps: String(input.slippageBps),
      });
      try {
        const res = await fetch(`/api/soroswap/quote?${qs}`, { signal: controller.signal });
        const json = (await res.json()) as { data?: SoroswapQuote; error?: { message?: string } };
        if (!res.ok || !json.data) {
          setState({
            status: "error",
            message: json.error?.message ?? "Could not fetch a Soroswap quote.",
          });
          return;
        }
        setState({ status: "ok", quote: json.data });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({ status: "error", message: "Could not reach the quote service." });
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `key` captures every field of `input` that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  return state;
}
