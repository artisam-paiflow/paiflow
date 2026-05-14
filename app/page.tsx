import Link from "next/link";

export default function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-brand-300">Pink Raft</h1>
        <nav className="flex gap-4 text-sm text-zinc-300">
          <Link href="/login" className="hover:text-white">
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mt-24 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-brand-400">
          Zaps for money · Stellar Soroban
        </p>
        <h2 className="mt-4 text-5xl font-bold leading-tight">
          Drag. Drop. <span className="text-brand-400">Deploy.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
          Connect triggers to actions on a canvas. Hit deploy. Pink Raft
          instantiates an audited Soroban contract — real money, real
          blockchain, ninety seconds end-to-end.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Link
            href="/register"
            className="rounded-lg bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-500"
          >
            Build a flow
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      <section className="mt-24 grid grid-cols-1 gap-6 md:grid-cols-3">
        {[
          {
            title: "Trigger",
            body: "On Receive USDC, or every hour. Pick one block.",
          },
          {
            title: "Action",
            body: "Pay one address, or split among many by percentage.",
          },
          {
            title: "Deploy",
            body: "Audited Splitter / Streamer / Conditional contracts on Soroban.",
          },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-zinc-800 p-6">
            <h3 className="text-lg font-semibold text-brand-300">{c.title}</h3>
            <p className="mt-2 text-zinc-300">{c.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-24 text-center text-sm text-zinc-500">
        Built for builders. Testnet by default. Non-custodial — Pink Raft never
        holds your keys.
      </footer>
    </main>
  );
}
