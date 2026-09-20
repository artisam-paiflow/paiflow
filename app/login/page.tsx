import LoginForm from "@/components/auth/login-form";
import SandboxEntry from "@/components/auth/sandbox-entry";
import Link from "next/link";
import Logo from "@/components/app/logo";
import { env } from "@/lib/env";

export const metadata = { title: "Sign in · Paiflow" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; reason?: string }>;
}) {
  const sandboxEnabled = env().SANDBOX_ENABLED;

  return (
    <main className="px-margin py-lg relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center">
      <Link href="/" className="inline-flex w-fit" aria-label="Paiflow home">
        <Logo size={24} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ AUTH · CREDENTIALS</p>
      <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
        Sign in.
      </h1>

      <LoginFormWrapper params={searchParams} />

      {sandboxEnabled ? <SandboxEntry /> : null}
    </main>
  );
}

async function LoginFormWrapper({
  params,
}: {
  params: Promise<{ from?: string; error?: string; reason?: string }>;
}) {
  const p = await params;
  return <LoginForm from={p.from} error={p.error} reason={p.reason} />;
}
