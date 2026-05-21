import Link from "next/link";
import Logo from "@/components/app/logo";

export const metadata = { title: "About · Pink Raft" };

export default function AboutPage() {
  return (
    <main className="px-margin py-xl mx-auto max-w-3xl">
      <Link href="/" className="inline-flex" aria-label="Pink Raft home">
        <Logo size={22} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ ABOUT</p>
      <h1 className="font-display text-on-surface mt-2 text-[56px] leading-[1.05] font-bold tracking-[-0.02em]">
        Programmable payments,
        <br />
        <span className="text-primary">without the Rust.</span>
      </h1>

      <p className="mt-md text-body-lg text-on-surface-variant">
        Pink Raft is the missing layer between non-coders and programmable payments. Drag triggers
        and actions onto a canvas, hit deploy, and a pre-audited Soroban contract is instantiated on
        Stellar in seconds.
      </p>
      <p className="mt-md text-body-md text-on-surface-variant">
        We pick three contract shapes — <span className="text-on-surface">Splitter</span>,{" "}
        <span className="text-on-surface">Streamer</span>,{" "}
        <span className="text-on-surface">Conditional</span> — and let you parameterize them
        visually. No Rust required. The contract templates ship pre-audited; deployments are
        non-custodial; you sign every transaction yourself.
      </p>

      <h2 className="mt-xl text-headline-sm text-on-surface">Principles</h2>
      <ul className="mt-md space-y-3">
        {[
          { label: "NON-CUSTODIAL", body: "We never hold your keys." },
          { label: "TESTNET BY DEFAULT", body: "Mainnet is gated behind a per-user allowlist." },
          {
            label: "AUDITED TEMPLATES ONLY",
            body: "No user-authored Rust on the request path.",
          },
          {
            label: "OPEN BY DEFAULT",
            body: "Every deployment shows its on-chain events live.",
          },
        ].map((p) => (
          <li key={p.label} className="glass-panel p-md flex items-start gap-3 rounded-xl">
            <span className="status-dot-live mt-1.5 h-1.5 w-1.5 shrink-0" />
            <div>
              <div className="text-label-sm text-primary font-mono">{p.label}</div>
              <p className="text-body-md text-on-surface mt-1">{p.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-xl text-label-sm text-on-surface-variant font-mono">
        QUESTIONS?{" "}
        <Link
          href="/login"
          className="text-primary underline-offset-4 transition-colors hover:underline"
        >
          SIGN IN
        </Link>{" "}
        TO START BUILDING.
      </p>
    </main>
  );
}
