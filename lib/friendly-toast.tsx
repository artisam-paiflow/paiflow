import { toast } from "sonner";
import { friendlyError } from "./friendly-error";

/**
 * Toast an error with a user-friendly message. Raw technical detail (Soroban
 * diagnostic dumps, API `error.details`) is preserved behind an expandable
 * "Show technical details" disclosure — never shown by default, never lost.
 */
export function toastError(err: unknown, fallback?: string): void {
  const { message, details } = friendlyError(err, fallback);
  if (!details) {
    toast.error(message);
    return;
  }
  toast.error(message, {
    duration: 10_000,
    description: (
      <details className="mt-1">
        <summary className="cursor-pointer text-xs underline opacity-80 select-none">
          Show technical details
        </summary>
        <pre className="mt-1 max-h-48 overflow-auto text-xs break-words whitespace-pre-wrap opacity-70">
          {details}
        </pre>
      </details>
    ),
  });
}
