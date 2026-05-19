import "server-only";
import { Resend } from "resend";
import { env } from "./env";
import { log } from "./log";

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: { message: string; cause?: unknown } };

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

// Lazy singleton so the SDK isn't instantiated when `RESEND_API_KEY` is unset
// (dev fallback path) and so `env()` can be invoked at call time, not module
// load — keeps test setup simple.
let client: Resend | null | undefined;
function getClient(): Resend | null {
  if (client !== undefined) return client;
  const e = env();
  client = e.RESEND_API_KEY ? new Resend(e.RESEND_API_KEY) : null;
  return client;
}

/**
 * Send a transactional email via Resend.
 *
 * Behavior:
 * - When `RESEND_API_KEY` is set, sends through the Resend API.
 * - When unset (dev), logs the payload to stdout and returns success with a
 *   mock id, so feature code can run end-to-end without external dependencies.
 *
 * Returns a discriminated union; callers should branch on `ok` rather than
 * relying on truthiness checks.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const e = env();
  const from = e.EMAIL_FROM;
  const recipients = Array.isArray(opts.to) ? opts.to.join(", ") : opts.to;

  const c = getClient();
  if (!c) {
    log.info(
      {
        from,
        to: recipients,
        subject: opts.subject,
        replyTo: opts.replyTo,
      },
      "[mail:dev-fallback] RESEND_API_KEY unset — email not delivered, logging instead",
    );
    // eslint-disable-next-line no-console
    console.log(
      `\n==== [DEV EMAIL] ====\nFrom: ${from}\nTo: ${recipients}\nSubject: ${opts.subject}\n${opts.replyTo ? `Reply-To: ${opts.replyTo}\n` : ""}--- HTML ---\n${opts.html}\n${opts.text ? `\n--- TEXT ---\n${opts.text}\n` : ""}=====================\n`,
    );
    return { ok: true, id: "dev-fallback" };
  }

  try {
    const { data, error } = await c.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      replyTo: opts.replyTo,
    });

    if (error) {
      log.error({ err: error, to: recipients, subject: opts.subject }, "resend send failed");
      return { ok: false, error: { message: error.message ?? "Resend rejected the email" } };
    }

    if (!data?.id) {
      return { ok: false, error: { message: "Resend returned no message id" } };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    log.error({ err, to: recipients, subject: opts.subject }, "resend transport exception");
    return { ok: false, error: { message: "Email transport error", cause: err } };
  }
}
