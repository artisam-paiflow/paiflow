import Link from "next/link";

export const metadata = { title: "Terms · Pink Raft" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-brand-300 font-bold">
        Pink Raft
      </Link>
      <h1 className="mt-8 text-4xl font-semibold">Terms of use</h1>
      <p className="mt-4 text-sm text-zinc-500">
        Last updated: {new Date().toISOString().slice(0, 10)}
      </p>
      <h2 className="mt-10 text-2xl font-semibold">No financial advice</h2>
      <p className="mt-4 text-zinc-300">
        Pink Raft is a developer tool. Anything you deploy is your own responsibility. We don't
        audit your flow's economic logic, only the underlying contract templates.
      </p>
      <h2 className="mt-10 text-2xl font-semibold">Non-custodial</h2>
      <p className="mt-4 text-zinc-300">
        You sign every transaction. We never see, store, or transmit your private key. Lose your
        wallet and we cannot recover your funds.
      </p>
      <h2 className="mt-10 text-2xl font-semibold">Testnet default</h2>
      <p className="mt-4 text-zinc-300">
        Deployments default to Stellar testnet. Mainnet is gated by an allowlist and an explicit
        confirmation. You agree to verify addresses and amounts before signing.
      </p>
      <h2 className="mt-10 text-2xl font-semibold">No warranty</h2>
      <p className="mt-4 text-zinc-300">
        The service is provided "as is" without warranty. To the maximum extent permitted by law,
        the operator is not liable for any loss arising from use of the service.
      </p>
    </main>
  );
}
