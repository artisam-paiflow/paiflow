import Link from "next/link";
import Logo from "@/components/app/logo";

export const metadata = { title: "Terms · Paiflow" };

export default function TermsPage() {
  return (
    <main className="px-margin py-xl mx-auto max-w-3xl">
      <Link href="/" className="inline-flex" aria-label="Paiflow home">
        <Logo size={22} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ TERMS</p>
      <h1 className="font-display text-on-surface mt-2 text-[48px] leading-[1.05] font-bold tracking-[-0.02em]">
        Terms of use.
      </h1>
      <p className="text-label-sm text-on-surface-variant mt-3 font-mono">
        LAST UPDATED: {new Date().toISOString().slice(0, 10)}
      </p>

      {[
        {
          title: "No financial advice",
          body: "Paiflow is a developer tool. Anything you deploy is your own responsibility. We don’t audit your flow’s economic logic, only the underlying contract templates.",
        },
        {
          title: "Non-custodial",
          body: "You sign every transaction. We never see, store, or transmit your private key. Lose your wallet and we cannot recover your funds.",
        },
        {
          title: "Testnet default",
          body: "Deployments default to Stellar testnet. Mainnet is gated by an allowlist and an explicit confirmation. You agree to verify addresses and amounts before signing.",
        },
        {
          title: "No warranty",
          body: "The service is provided “as is” without warranty. To the maximum extent permitted by law, the operator is not liable for any loss arising from use of the service.",
        },
      ].map((s) => (
        <section key={s.title} className="mt-xl">
          <h2 className="text-headline-sm text-on-surface">{s.title}</h2>
          <p className="text-body-md text-on-surface-variant mt-3">{s.body}</p>
        </section>
      ))}
    </main>
  );
}
