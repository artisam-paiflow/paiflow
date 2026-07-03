import Link from "next/link";
import Logo from "@/components/app/logo";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export const metadata = { title: "Forgot password · Paiflow" };

export default function ForgotPasswordPage() {
  return (
    <main className="px-margin py-lg relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center">
      <Link href="/" className="inline-flex w-fit" aria-label="Paiflow home">
        <Logo size={24} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">
        / AUTH · PASSWORD RESET
      </p>
      <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
        Forgot your password?
      </h1>
      <p className="text-body-md text-on-surface-variant mt-3">
        Enter the email address on your account. We&apos;ll send you a link to set a new password.
      </p>

      <ForgotPasswordForm />

      <p className="mt-md text-label-sm text-on-surface-variant font-mono">
        REMEMBERED IT?{" "}
        <Link
          href="/login"
          className="text-primary hover:text-primary-fixed underline-offset-4 transition-colors hover:underline"
        >
          BACK TO SIGN IN
        </Link>
      </p>
    </main>
  );
}
