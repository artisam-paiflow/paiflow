import Link from "next/link";
import Logo from "@/components/app/logo";
import GoogleButton from "@/components/auth/google-button";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Complete your signup · Paiflow" };

export default async function GoogleSignupPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const available = env().GOOGLE_AUTH_ENABLED && env().ALLOW_GOOGLE_REGISTRATION;
  return (
    <main className="px-margin py-lg relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center">
      <Link href="/" className="inline-flex w-fit" aria-label="Paiflow home">
        <Logo size={24} />
      </Link>
      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ AUTH · NEW USER</p>
      <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
        Complete your signup.
      </h1>
      {available ? (
        <GoogleButton signup codeScreen from={from} authOrigin={new URL(env().AUTH_URL).origin} />
      ) : (
        <p role="status" className="text-on-surface-variant mt-md">
          New Google registrations are currently closed. Ask your organizer for help.
        </p>
      )}
      <Link href="/login" className="text-primary mt-6">
        Return to sign in
      </Link>
    </main>
  );
}
