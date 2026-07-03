import Link from "next/link";
import RegisterForm from "@/components/auth/register-form";
import { env } from "@/lib/env";
import Logo from "@/components/app/logo";

export const metadata = { title: "Create account · Paiflow" };

export default function RegisterPage() {
  const allowed = env().ALLOW_PUBLIC_REGISTRATION;
  return (
    <main className="px-margin py-lg relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center">
      <Link href="/" className="inline-flex w-fit" aria-label="Paiflow home">
        <Logo size={24} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ AUTH · NEW USER</p>
      <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
        Create account.
      </h1>

      {allowed ? (
        <RegisterForm />
      ) : (
        <div className="glass-panel mt-md p-md rounded-xl">
          <div className="text-label-sm text-tertiary flex items-center gap-2 font-mono">
            <span className="material-symbols-outlined text-[14px]">lock</span>
            REGISTRATION DISABLED
          </div>
          <p className="text-body-md text-on-surface-variant mt-3">
            Public registration is disabled on this instance. Ask your admin to create an account,
            then{" "}
            <Link
              href="/login"
              className="text-primary underline-offset-4 transition-colors hover:underline"
            >
              sign in
            </Link>
            .
          </p>
        </div>
      )}
    </main>
  );
}
