import Link from "next/link";
import RegisterForm from "@/components/auth/register-form";
import { env } from "@/lib/env";

export const metadata = { title: "Create account · Pink Raft" };

export default function RegisterPage() {
  const allowed = env().ALLOW_PUBLIC_REGISTRATION;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <Link href="/" className="text-brand-300 text-xl font-bold">
        Pink Raft
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">Create account</h1>
      {allowed ? (
        <RegisterForm />
      ) : (
        <p className="mt-4 rounded border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          Public registration is disabled on this instance. Ask your admin to
          create an account, then{" "}
          <Link href="/login" className="text-brand-300 hover:underline">
            sign in
          </Link>
          .
        </p>
      )}
    </main>
  );
}
