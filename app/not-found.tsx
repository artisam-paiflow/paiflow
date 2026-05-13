import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-brand-300 text-sm tracking-[0.2em] uppercase">404</div>
      <h1 className="mt-3 text-4xl font-semibold">Not found</h1>
      <p className="mt-3 text-zinc-400">That page doesn't exist or you don't have access.</p>
      <Link
        href="/"
        className="bg-brand-600 hover:bg-brand-500 mt-8 rounded-md px-4 py-2 font-medium"
      >
        Back home
      </Link>
    </main>
  );
}
