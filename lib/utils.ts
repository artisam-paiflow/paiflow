import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddr(addr: string, head = 6, tail = 6): string {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortAddrExtraShort(addr: string): string {
  return shortAddr(addr, 3, 3);
}

export function formatStroops(stroops: bigint | string, decimals = 7): string {
  const n = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${out}` : out;
}
