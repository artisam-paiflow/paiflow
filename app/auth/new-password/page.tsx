import Link from "next/link";
import Logo from "@/components/app/logo";
import NewPasswordForm from "@/components/auth/new-password-form";

// `referrer: no-referrer` ensures the `?token=…` URL is never sent in the
// `Referer` header to anything the user navigates to from this page.
export const metadata = {
  title: "Set new password · Pink Raft",
  referrer: "no-referrer" as const,
};

export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="px-margin py-lg relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center">
      <Link href="/" className="inline-flex w-fit" aria-label="Pink Raft home">
        <Logo size={24} />
      </Link>

      <p className="mt-lg text-label-sm text-on-surface-variant font-mono">/ AUTH · NEW PASSWORD</p>
      <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
        Choose a new password.
      </h1>
      <p className="text-body-md text-on-surface-variant mt-3">
        Pick something strong. Your existing sessions will be signed out on every device.
      </p>

      <NewPasswordForm token={token ?? null} />

      <p className="mt-md text-label-sm text-on-surface-variant font-mono">
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
