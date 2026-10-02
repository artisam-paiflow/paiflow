"use client";

import { use, useState } from "react";
import type { TrustlineCheck } from "@/lib/stellar/trustline-check";
import { shortAddr } from "@/lib/utils";

type Context = "deploy" | "trigger";

const FOOTER: Record<Context, string> = {
  deploy:
    "This is a warning, not a block: you can still deploy. The recipient can add the trustline any time before the flow is triggered.",
  trigger:
    "You can still trigger, but the payout will revert until the recipient adds this exact trustline.",
};

function CopyableAddress({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (insecure context); the full value is
      // still in the title for the user to read.
    }
  }
  return (
    <span className="inline-flex items-center gap-1 align-baseline">
      <code title={value} className="font-mono text-amber-100">
        {shortAddr(value)}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${name}`}
        title={value}
        className="text-amber-300 hover:text-amber-100"
      >
        <span aria-hidden className="material-symbols-outlined text-[12px]">
          {copied ? "check" : "content_copy"}
        </span>
      </button>
    </span>
  );
}

function Who({ check }: { check: TrustlineCheck }) {
  return (
    <>
      {check.label ? <strong>{check.label}</strong> : null}
      {check.label ? " (" : null}
      <CopyableAddress value={check.address} name="recipient address" />
      {check.label ? ")" : null}
    </>
  );
}

/** Pure render of trustline check results; renders nothing when all is well. */
export function TrustlineWarningList({
  checks,
  network,
  context,
}: {
  checks: TrustlineCheck[];
  network: "testnet" | "mainnet";
  context: Context;
}) {
  const warnings = checks.filter(
    (c): c is Extract<TrustlineCheck, { status: "no_trustline" | "no_account" }> =>
      c.status === "no_trustline" || c.status === "no_account",
  );
  const unknown = new Set(checks.filter((c) => c.status === "unknown").map((c) => c.address));
  if (warnings.length === 0 && unknown.size === 0) return null;

  return (
    <section
      aria-labelledby="trustline-warnings-heading"
      className={
        warnings.length > 0 ? "rounded-xl border border-amber-900 bg-amber-950/20 p-4" : "px-1"
      }
      data-testid="trustline-warnings"
    >
      {warnings.length > 0 && (
        <>
          <h2
            id="trustline-warnings-heading"
            className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-wide text-amber-400 uppercase"
          >
            <span aria-hidden className="material-symbols-outlined text-[14px]">
              warning
            </span>
            Recipient can&apos;t receive this payout yet
          </h2>
          <ul className="mt-2 space-y-2 text-sm text-amber-200">
            {warnings.map((c) => (
              <li key={`${c.nodeId}-${c.address}`}>
                {c.status === "no_trustline" ? (
                  <>
                    <Who check={c} /> has no {c.assetCode} trustline from issuer{" "}
                    <CopyableAddress value={c.assetIssuer} name={`${c.assetCode} issuer address`} />
                    .
                    {c.otherIssuers.length > 0 && (
                      <>
                        {" "}
                        It trusts {c.assetCode} from{" "}
                        {c.otherIssuers.map((i, idx) => (
                          <span key={i}>
                            {idx > 0 ? ", " : null}
                            <CopyableAddress value={i} name="other issuer address" />
                          </span>
                        ))}{" "}
                        instead, which is a different asset.
                      </>
                    )}{" "}
                    The payout will fail until they add a trustline to {c.assetCode} from this exact
                    issuer.
                  </>
                ) : (
                  <>
                    <Who check={c} /> does not exist on {network} yet, so it cannot hold{" "}
                    {c.assetCode} from issuer{" "}
                    <CopyableAddress value={c.assetIssuer} name={`${c.assetCode} issuer address`} />
                    . The account must be funded and add that trustline before the payout.
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-300">{FOOTER[context]}</p>
        </>
      )}
      {unknown.size > 0 && (
        <p
          id={warnings.length === 0 ? "trustline-warnings-heading" : undefined}
          className={`text-on-surface-variant font-mono text-xs ${warnings.length ? "mt-2" : ""}`}
        >
          Couldn&apos;t check recipient trustlines for {unknown.size}{" "}
          {unknown.size === 1 ? "account" : "accounts"} right now.
        </p>
      )}
    </section>
  );
}

/** Resolves the server's trustline check; render inside a `<Suspense>`. */
export default function TrustlineWarnings({
  check,
  network,
  context,
}: {
  check: Promise<TrustlineCheck[]>;
  network: "testnet" | "mainnet";
  context: Context;
}) {
  return <TrustlineWarningList checks={use(check)} network={network} context={context} />;
}
