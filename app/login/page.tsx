import LoginForm from "@/components/auth/login-form";
import Link from "next/link";

export const metadata = { title: "Sign in · Pink Raft" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <Link href="/" className="text-brand-300 text-xl font-bold">
        Pink Raft
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Use the admin credentials seeded for your environment, or your own account.
      </p>
      <LoginFormWrapper params={searchParams} />
      <p className="mt-6 text-sm text-zinc-400">
        No account?{" "}
        <Link href="/register" className="text-brand-300 hover:underline">
          Create one
        </Link>
        .
      </p>
    </main>
  );
}

async function LoginFormWrapper({
  params,
}: {
  params: Promise<{ from?: string; error?: string }>;
}) {
  const p = await params;
  return <LoginForm from={p.from} error={p.error} />;
}
