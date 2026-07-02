"use client";

import { useState } from "react";
import Link from "next/link";
import { TriggerButton } from "@/components/deploy/trigger-button";
import { tokenAmountToStroops } from "@/lib/flows/schema";

export default function AllowanceClient({
  deploymentId,
  contractAddress,
  flowName,
  network,
  assetLabel,
  templateKind,
}: {
  deploymentId: string;
  contractAddress: string;
  flowName: string;
  network: "testnet" | "mainnet";
  assetLabel: string;
  templateKind: "SUBSCRIPTION" | "PAYROLL";
}) {
  const [amount, setAmount] = useState("");
  const [amountSet, setAmountSet] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
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
            / ALLOWANCE · {network.toUpperCase()}
          </p>
          <h1 className="font-display text-[32px] leading-[1.1] font-semibold tracking-[-0.02em]">
            {flowName}
          </h1>
        </div>

        <div className="glass-panel p-md space-y-md rounded-xl">
          <div>
            <div className="text-label-sm text-on-surface-variant font-mono uppercase">
              Subscription contract
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
              Amount to approve ({assetLabel})
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
              disabled={amountSet}
            />
            {amountSet && (
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

          {!amountSet && amount && /^\d+(\.\d+)?$/.test(amount) && amount !== "0" && (
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
            amount={amountSet ? tokenAmountToStroops(amount) : ""}
            mode="allowance"
            templateKind={templateKind}
          />

          <p className="text-label-sm text-on-surface-variant text-center font-mono">
            Each approval adds to your existing allowance.
          </p>
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
