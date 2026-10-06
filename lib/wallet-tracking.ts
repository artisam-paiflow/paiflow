"use client";
import type { WalletSurface } from "@/lib/analytics/events";
import type { WalletConnectionInput } from "@/lib/analytics/schema";
import { setPersonProps } from "@/lib/analytics/client";
const STORAGE_KEY = "paiflow-wallet-delivery-v2";
const MAX_PENDING = 50;
let subject: string | null | undefined;
let hydrated = false;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
type PendingConnection = Omit<WalletConnectionInput, "sessionUserId"> & {
  sessionUserId?: string | null;
};
let pending: PendingConnection[] = [];
export function setWalletTrackingSubject(userId: string | null | undefined) {
  subject = userId;
  if (subject !== undefined) {
    hydrate();
    for (const entry of pending)
      if (entry.sessionUserId === undefined) entry.sessionUserId = subject;
    persist();
  }
}
function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    /* Memory queue still retries. */
  }
}
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const rows: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(rows))
      pending = rows
        .filter((v): v is PendingConnection =>
          Boolean(
            v &&
            typeof v === "object" &&
            typeof v.connectionId === "string" &&
            typeof v.address === "string" &&
            typeof v.walletId === "string" &&
            ["testnet", "mainnet"].includes(v.network) &&
            ["deploy_review", "trigger", "contract_call", "payroll"].includes(v.surface) &&
            (v.sessionUserId === undefined ||
              v.sessionUserId === null ||
              typeof v.sessionUserId === "string"),
          ),
        )
        .slice(0, MAX_PENDING);
  } catch {
    /* Unavailable/corrupt storage does not block wallet activity. */
  }
}
function observe(state: "acknowledged" | "retrying" | "session_changed" | "queue_full") {
  window.dispatchEvent(
    new CustomEvent("wallet-connection-delivery", { detail: { state, pending: pending.length } }),
  );
}
export async function resumeWalletConnections(): Promise<void> {
  if (typeof window === "undefined" || running || subject === undefined) return;
  hydrate();
  running = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    for (const entry of [...pending]) {
      if (subject === undefined) break;
      if (entry.sessionUserId !== subject) {
        pending = pending.filter((e) => e.connectionId !== entry.connectionId);
        persist();
        observe("session_changed");
        continue;
      }
      try {
        const response = await fetch("/api/audit/wallet-connection", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(entry),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error("Connection delivery not acknowledged");
        const body = await response.json();
        if (body.data?.ok !== true || body.data?.connectionId !== entry.connectionId)
          throw new Error("Invalid acknowledgement");
        pending = pending.filter((e) => e.connectionId !== entry.connectionId);
        persist();
        observe("acknowledged");
      } catch {
        observe("retrying");
        break;
      }
    }
  } finally {
    running = false;
    if (pending.length && subject !== undefined)
      timer = setTimeout(() => {
        void resumeWalletConnections();
      }, 30_000);
  }
}
/** Returns immediately; an acknowledged server record is the business event. */
export async function trackWalletConnection(opts: {
  address: string;
  network: "testnet" | "mainnet";
  walletId: string;
  surface: WalletSurface;
}) {
  hydrate();
  if (pending.length >= MAX_PENDING) {
    observe("queue_full");
    return;
  }
  pending.push({ ...opts, connectionId: crypto.randomUUID(), sessionUserId: subject });
  persist();
  setPersonProps({ wallet_address: opts.address }, { wallet_address_first: opts.address });
  void resumeWalletConnections();
}
