import Link from "next/link";

export const metadata = { title: "About · Pink Raft" };

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-brand-300 font-bold">
        Pink Raft
      </Link>
      <h1 className="mt-8 text-4xl font-semibold">About Pink Raft</h1>
      <p className="mt-6 text-zinc-300">
        Pink Raft is the missing layer between non-coders and programmable payments. Drag triggers
        and actions onto a canvas, hit deploy, and a pre-audited Soroban contract is instantiated on
        Stellar in seconds.
      </p>
      <p className="mt-4 text-zinc-300">
        We pick three contract shapes — Splitter, Streamer, Conditional — and let you parameterize
        them visually. No Rust required. The contract templates ship pre-audited; deployments are
        non-custodial; you sign every transaction yourself.
      </p>
      <h2 className="mt-12 text-2xl font-semibold">Principles</h2>
      <ul className="mt-4 list-inside list-disc space-y-2 text-zinc-300">
        <li>Non-custodial. We never hold your keys.</li>
        <li>Testnet by default. Mainnet is gated behind a per-user allowlist.</li>
        <li>Audited templates only. No user-authored Rust on the request path.</li>
        <li>Open about what's running: every deployment shows its on-chain events live.</li>
      </ul>
      <p className="mt-12 text-sm text-zinc-500">
        Questions?{" "}
        <Link href="/login" className="text-brand-300">
          Sign in
        </Link>{" "}
        to start building.
      </p>
    </main>
  );
}
