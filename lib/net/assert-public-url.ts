/**
 * The `AppError` face of `checkPublicHttpsUrl` (see `public-url.ts` for what is
 * checked and why). Split in two so the checker stays importable from a script
 * and from tests without dragging in `next/server` via `lib/errors.ts`.
 *
 * `UnsafeUrlError` carries the reason as a field rather than in its text: the
 * crons have to tell a deterministic refusal from a transient DNS failure, and
 * classifying by substring is exactly the bug #581 also had to fix
 * (`isExpectedSkipError` matching on a message a tenant can influence).
 */
import "server-only";
import { AppError } from "@/lib/errors";
import {
  TERMINAL_URL_REJECTIONS,
  checkPublicHttpsUrl,
  type CheckPublicHttpsUrlOptions,
  type UrlRejectionReason,
} from "./public-url";

export class UnsafeUrlError extends AppError {
  readonly reason: UrlRejectionReason;

  constructor(reason: UrlRejectionReason, detail: string, subject: string, field: string) {
    const message = `${subject} must be a public https:// endpoint: ${detail}`;
    // The same text in `fields` as in `message`: the relayer panel renders only
    // `error.message`, so the message has to stand alone, and a machine caller
    // reading `fields` should not get a shorter story.
    super("VALIDATION", message, { [field]: [message] });
    this.name = "UnsafeUrlError";
    this.reason = reason;
  }

  /** Will this URL be refused again next tick, however long we wait? */
  get terminal(): boolean {
    return TERMINAL_URL_REJECTIONS.has(this.reason);
  }
}

export type AssertPublicUrlOptions = CheckPublicHttpsUrlOptions & {
  /** How the URL is named to the tenant, e.g. "Relayer URL". */
  subject?: string;
  /** The `fields` key, so a form can highlight the right input. */
  field?: string;
};

/** Returns the parsed, normalised URL, or throws `UnsafeUrlError` (422). */
export async function assertPublicUrl(
  raw: string,
  opts: AssertPublicUrlOptions = {},
): Promise<URL> {
  const { subject = "URL", field = "url", ...checkOpts } = opts;
  const result = await checkPublicHttpsUrl(raw, checkOpts);
  if (!result.ok) {
    throw new UnsafeUrlError(result.reason, result.detail, subject, field);
  }
  return result.url;
}
