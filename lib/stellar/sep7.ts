import type { Asset } from "@/lib/flows/schema";
import { resolveAsset } from "./assets";

export function sep7PaymentUri(opts: {
  destination: string;
  asset?: Asset;
  amount?: string;
  memo?: string;
  message?: string;
}): string {
  const params = new URLSearchParams();
  params.set("destination", opts.destination);
  if (opts.asset && opts.asset.kind !== "native") {
    const a = resolveAsset(opts.asset);
    params.set("asset_code", a.code);
    if (a.issuer) params.set("asset_issuer", a.issuer);
  }
  if (opts.amount) params.set("amount", opts.amount);
  if (opts.memo) {
    params.set("memo", opts.memo);
    params.set("memo_type", "MEMO_TEXT");
  }
  if (opts.message) params.set("msg", opts.message);
  return `web+stellar:pay?${params.toString()}`;
}

export function sep7InvokeUri(opts: {
  destination: string;
  function: string;
  paramName?: string;
  paramType?: "i128" | "u32" | "address" | "symbol";
  message?: string;
}): string {
  const params = new URLSearchParams();
  params.set("destination", opts.destination);
  params.set("fn", opts.function);
  if (opts.paramName && opts.paramType) {
    params.set("param[name]", opts.paramName);
    params.set("param[type]", opts.paramType);
  }
  if (opts.message) params.set("msg", opts.message);
  return `web+stellar:invoke?${params.toString()}`;
}
