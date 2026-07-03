import "server-only";
import { sendEmail, type SendEmailResult } from "@/lib/mail";

/**
 * Escape a small set of HTML metacharacters so user-controlled values
 * (username, email) can be safely interpolated into the template. Resend
 * accepts HTML directly; nothing here is auto-escaped for us.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildHtml(resetLink: string, recipientLabel: string): string {
  const safeLink = escapeHtml(resetLink);
  const safeLabel = escapeHtml(recipientLabel);
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#0e0e0e;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e5e2e1;">
    <div style="max-width:560px;margin:0 auto;background:#1c1b1b;border:1px solid #5c3f46;border-radius:12px;padding:32px;">
      <div style="font-size:22px;font-weight:700;color:#ffb1c4;margin-bottom:8px;">Reset your Paiflow password</div>
      <p style="font-size:15px;line-height:1.55;color:#e5e2e1;">Hi ${safeLabel},</p>
      <p style="font-size:15px;line-height:1.55;color:#e5e2e1;">We received a request to reset the password on your Paiflow account. Click the button below within the next hour to choose a new password.</p>
      <p style="margin:28px 0;">
        <a href="${safeLink}" style="display:inline-block;background:#ffb1c4;color:#65002e;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px;">Choose a new password</a>
      </p>
      <p style="font-size:13px;line-height:1.55;color:#ac878f;">If the button doesn't work, copy this link into your browser:</p>
      <p style="font-size:12px;line-height:1.5;color:#ac878f;word-break:break-all;"><a href="${safeLink}" style="color:#98cbff;">${safeLink}</a></p>
      <hr style="border:none;border-top:1px solid #5c3f46;margin:28px 0;" />
      <p style="font-size:12px;line-height:1.5;color:#ac878f;">If you didn't request a password reset, you can safely ignore this email — your account is unchanged. The link will expire in 60 minutes.</p>
    </div>
  </body>
</html>`;
}

function buildText(resetLink: string, recipientLabel: string): string {
  return `Hi ${recipientLabel},

We received a request to reset the password on your Paiflow account.
Open the link below within the next hour to choose a new password:

${resetLink}

If you didn't request a password reset, you can safely ignore this email —
your account is unchanged. The link expires in 60 minutes.`;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetLink: string;
  recipientLabel: string;
}): Promise<SendEmailResult> {
  return sendEmail({
    to: opts.to,
    subject: "Reset your Paiflow password",
    html: buildHtml(opts.resetLink, opts.recipientLabel),
    text: buildText(opts.resetLink, opts.recipientLabel),
  });
}
