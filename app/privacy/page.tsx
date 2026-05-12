import Link from "next/link";

export const metadata = { title: "Privacy · Pink Raft" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-brand-300 font-bold">
        Pink Raft
      </Link>
      <h1 className="mt-8 text-4xl font-semibold">Privacy</h1>
      <p className="mt-4 text-sm text-zinc-500">
        Last updated: {new Date().toISOString().slice(0, 10)}
      </p>
      <h2 className="mt-10 text-2xl font-semibold">What we store</h2>
      <ul className="mt-4 list-inside list-disc space-y-2 text-zinc-300">
        <li>
          <strong>Account</strong>: username, an argon2id-hashed password, optional email, login
          timestamps, and audit log entries.
        </li>
        <li>
          <strong>Flows &amp; deployments</strong>: the canvas graph you author, the parameters you
          choose, the public contract address you deploy to Stellar, and the on-chain event stream
          we index.
        </li>
        <li>
          <strong>Passkeys</strong>: public WebAuthn credentials. We never see your private key.
        </li>
      </ul>
      <h2 className="mt-10 text-2xl font-semibold">What we do not store</h2>
      <ul className="mt-4 list-inside list-disc space-y-2 text-zinc-300">
        <li>Your Stellar secret key. Pink Raft is non-custodial.</li>
        <li>Card details. We don't take payments.</li>
      </ul>
      <h2 className="mt-10 text-2xl font-semibold">Third parties</h2>
      <p className="mt-4 text-zinc-300">
        Stellar Horizon and Soroban RPC see the public network traffic required to read or submit
        your transactions. Optionally, error traces are sent to Sentry; this is off unless the
        operator configures <code>SENTRY_DSN</code>.
      </p>
    </main>
  );
}
