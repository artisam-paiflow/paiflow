import Link from "next/link";
import Logo from "@/components/app/logo";

export const metadata = { title: "Privacy · Paiflow" };

export default function PrivacyPage() {
  return (
    <main className="px-margin py-xl mx-auto max-w-3xl">
      <Link href="/" className="inline-flex" aria-label="Paiflow home">
        <Logo size={22} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ PRIVACY</p>
      <h1 className="font-display text-on-surface mt-2 text-[48px] leading-[1.05] font-bold tracking-[-0.02em]">
        Privacy.
      </h1>
      <p className="text-label-sm text-on-surface-variant mt-3 font-mono">
        LAST UPDATED: {new Date().toISOString().slice(0, 10)}
      </p>

      <h2 className="mt-xl text-headline-sm text-on-surface">What we store</h2>
      <ul className="mt-md text-body-md text-on-surface space-y-3">
        <li className="glass-panel p-md rounded-xl">
          <strong className="text-on-surface">Account</strong>{" "}
          <span className="text-on-surface-variant">
            — username, an argon2id-hashed password, optional email, login timestamps, and audit log
            entries.
          </span>
        </li>
        <li className="glass-panel p-md rounded-xl">
          <strong className="text-on-surface">Flows &amp; deployments</strong>{" "}
          <span className="text-on-surface-variant">
            — the canvas graph you author, the parameters you choose, the public contract address
            you deploy to Stellar, and the on-chain event stream we index.
          </span>
        </li>
        <li className="glass-panel p-md rounded-xl">
          <strong className="text-on-surface">Passkeys</strong>{" "}
          <span className="text-on-surface-variant">
            — public WebAuthn credentials. We never see your private key.
          </span>
        </li>
      </ul>

      <h2 className="mt-xl text-headline-sm text-on-surface">What we do not store</h2>
      <ul className="mt-md text-body-md text-on-surface-variant space-y-2">
        <li className="flex items-start gap-2">
          <span className="material-symbols-outlined text-tertiary mt-0.5 text-[14px]">block</span>
          Your Stellar secret key. Paiflow is non-custodial.
        </li>
        <li className="flex items-start gap-2">
          <span className="material-symbols-outlined text-tertiary mt-0.5 text-[14px]">block</span>
          Card details. We don&rsquo;t take payments.
        </li>
      </ul>

      <h2 className="mt-xl text-headline-sm text-on-surface">Third parties</h2>
      <p className="mt-md text-body-md text-on-surface-variant">
        Stellar Horizon and Soroban RPC see the public network traffic required to read or submit
        your transactions. Optionally, error traces are sent to Sentry; this is off unless the
        operator configures{" "}
        <code className="border-outline-variant/30 bg-surface-container-low/40 text-label-sm text-on-surface rounded border px-1.5 py-0.5 font-mono">
          SENTRY_DSN
        </code>
        .
      </p>
    </main>
  );
}
