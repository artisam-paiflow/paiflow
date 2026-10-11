import Link from "next/link";
import { googleErrorMessage } from "@/lib/auth/google-messages";
export default async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="px-margin py-lg mx-auto max-w-md">
      <h1 className="font-display text-on-surface text-3xl">Sign-in could not be completed.</h1>
      <p role="alert" className="text-on-surface-variant mt-4">
        {googleErrorMessage(error)}
      </p>
      <div className="mt-6 flex gap-6">
        <Link href="/login">Return to sign in</Link>
        <Link href="/account">Account settings</Link>
        {error === "signup-code-required" ? <Link href="/register">Create account</Link> : null}
      </div>
    </main>
  );
}
