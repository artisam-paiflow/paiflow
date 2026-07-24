export function PageLoader({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="px-margin flex min-h-screen flex-col items-center justify-center">
      <span className="material-symbols-outlined text-primary animate-spin text-4xl">
        progress_activity
      </span>
      <p className="text-label-sm text-on-surface-variant mt-4 font-mono uppercase">{message}</p>
    </div>
  );
}
