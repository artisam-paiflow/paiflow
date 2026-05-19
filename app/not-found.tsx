import Link from "next/link";

export default function NotFound() {
  return (
    <main className="px-margin mx-auto flex min-h-screen max-w-md flex-col items-center justify-center text-center">
      <div className="glass-panel-hero p-lg w-full rounded-full">
        <div className="text-label-sm text-on-surface-variant flex items-center justify-center gap-2 font-mono">
          <span className="material-symbols-outlined text-[14px]">explore_off</span>
          404 · NOT FOUND
        </div>
        <h1 className="font-display text-on-surface mt-3 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          That page doesn&rsquo;t exist.
        </h1>
        <p className="text-body-md text-on-surface-variant mt-3">Or you don&rsquo;t have access.</p>
        <Link
          href="/"
          className="mt-md bg-primary px-md text-label-md text-on-primary inline-flex items-center justify-center gap-2 rounded-lg py-2.5 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_20px_rgba(255,177,196,0.55)] active:scale-95"
        >
          <span className="material-symbols-outlined text-[16px]">home</span>
          BACK HOME
        </Link>
      </div>
    </main>
  );
}
