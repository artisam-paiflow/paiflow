"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TriggerButton } from "@/components/deploy/trigger-button";
import { tokenAmountToStroops } from "@/lib/flows/schema";
import type { InboundRequirement } from "@/lib/flows/inbound-amount";
import { formatStroops } from "@/lib/utils";
import { track } from "@/lib/analytics/client";

export default function TriggerClient({
  deploymentId,
  contractAddress,
  flowName,
  network,
  requirement,
  isDeposit,
  assetLabel,
}: {
  deploymentId: string;
  contractAddress: string;
  flowName: string;
  network: "testnet" | "mainnet";
  requirement: InboundRequirement;
  isDeposit?: boolean;
  assetLabel?: string;
}) {
  // An `exact` flow spends precisely what it is configured to spend, and a
  // fixed payer keeps whatever arrives beyond that (see inbound-amount.ts), so
  // the sender doesn't get to choose: the field is filled in and locked.
  const locked = requirement.kind === "exact";
  const lockedAmount = locked ? formatStroops(requirement.stroops) : "";
  const [amount, setAmount] = useState(lockedAmount);
  const [amountSet, setAmountSet] = useState(locked);

  const minStroops = requirement.kind === "minimum" ? BigInt(requirement.stroops) : null;
  const belowMinimum =
    minStroops !== null &&
    /^\d+(\.\d+)?$/.test(amount) &&
    BigInt(tokenAmountToStroops(amount)) < minStroops;

  useEffect(() => {
    track("trigger_page_viewed", { deployment_id: deploymentId });
  }, [deploymentId]);

  useEffect(() => {
    // The flow is authoritative over a link someone pasted.
    if (locked) return;
    const params = new URLSearchParams(window.location.search);
    const urlAmount = params.get("amount");
    if (urlAmount && /^\d+(\.\d+)?$/.test(urlAmount) && urlAmount !== "0") {
      setAmount(urlAmount);
      setAmountSet(true);
    }
  }, [locked]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for iOS Safari < 16.4 and insecure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="bg-surface text-on-surface p-md flex min-h-screen flex-col items-center justify-center">
      <div className="space-y-md w-full max-w-sm">
        <div className="space-y-1 text-center">
          <p className="text-label-sm text-primary font-mono">
            / {isDeposit ? "DEPOSIT" : "TRIGGER"} · {network.toUpperCase()}
          </p>
          <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-[-0.02em]">
            {flowName}
          </h1>
        </div>

        <div className="glass-panel p-md space-y-md rounded-xl">
          <div>
            <div className="text-label-sm text-on-surface-variant font-mono uppercase">
              Contract address
            </div>
            <button
              onClick={() => copy(contractAddress)}
              className="text-on-surface hover:text-primary mt-1 text-left font-mono text-[12px] break-all transition-colors"
            >
              {contractAddress}
            </button>
          </div>

          <div>
            <div className="text-label-sm text-on-surface-variant font-mono uppercase">
              Amount {assetLabel ? `(${assetLabel})` : ""}
            </div>
            <input
              className="input mt-1 w-full"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 5"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                setAmountSet(false);
              }}
              onBlur={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                setAmountSet(false);
              }}
              readOnly={locked}
              disabled={amountSet && !locked}
              aria-describedby={locked || minStroops !== null ? "amount-note" : undefined}
              data-testid="trigger-amount"
            />
            {locked ? (
              <p
                id="amount-note"
                className="text-label-sm text-on-surface-variant mt-1 font-mono"
                data-testid="amount-locked-note"
              >
                Set by this flow — it pays out exactly {lockedAmount} {assetLabel ?? ""}.
              </p>
            ) : minStroops !== null ? (
              <p
                id="amount-note"
                className={`text-label-sm mt-1 font-mono ${
                  belowMinimum ? "text-error" : "text-on-surface-variant"
                }`}
              >
                {belowMinimum
                  ? `This flow pays out ${formatStroops(minStroops)} ${assetLabel ?? ""} — send at least that much.`
                  : `Minimum ${formatStroops(minStroops)} ${assetLabel ?? ""}.`}
              </p>
            ) : null}
            {amountSet && !locked && (
              <button
                onClick={() => {
                  setAmount("");
                  setAmountSet(false);
                }}
                className="text-label-sm text-secondary mt-1 font-mono hover:underline"
              >
                Change amount
              </button>
            )}
          </div>

          {!amountSet &&
            !belowMinimum &&
            amount &&
            /^\d+(\.\d+)?$/.test(amount) &&
            amount !== "0" && (
              <button
                onClick={() => setAmountSet(true)}
                className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 w-full rounded border px-3 py-1.5 font-mono text-xs transition-colors"
              >
                CONFIRM AMOUNT
              </button>
            )}

          <TriggerButton
            deploymentId={deploymentId}
            network={network}
            amount={locked ? requirement.stroops : amountSet ? tokenAmountToStroops(amount) : ""}
            isDeposit={isDeposit}
          />
        </div>

        <p className="text-label-sm text-on-surface-variant text-center font-mono">
          <Link href="/dashboard" className="hover:text-primary transition-colors">
            Back to Paiflow
          </Link>
        </p>
      </div>
    </div>
  );
}
