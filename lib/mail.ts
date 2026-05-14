import { Resend } from "resend";

// Retrieve environment variables
const apiKey = process.env.RESEND_API_KEY;
const defaultFromAddress = process.env.EMAIL_FROM || "Pink Raft <onboarding@resend.dev>";

// 1. Initialize the wrapper client.
export const resend = apiKey ? new Resend(apiKey) : null;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail({ to, subject, html, text, replyTo }: SendEmailOptions) {
  const recipients = Array.isArray(to) ? to.join(", ") : to;

  // 2. Local Dev Fallback Interceptor
  if (!resend) {
    console.log("\n==================================================");
    console.log(`[LOCAL DEV EMAIL LOG - RESEND FALLBACK]`);
    console.log(`From:     ${defaultFromAddress}`);
    console.log(`To:       ${recipients}`);
    console.log(`Subject:  ${subject}`);
    if (replyTo) console.log(`Reply-To: ${replyTo}`);
    console.log("--------------------------------------------------");
    console.log(`Body (HTML):\n${html}`);
    if (text) console.log(`\nBody (Plain-Text):\n${text}`);
    console.log("==================================================");

    return { data: { id: "mock_id_dev_fallback_success" }, error: null };
  }

  // 3. Official Active Resend Production Route
  try {
    const { data, error } = await resend.emails.send({
      from: defaultFromAddress,
      to,
      subject,
      html,
      text,
      replyTo,
    });

    if (error) {
      console.error("Resend Delivery Client Error Object:", error);
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error("Critical exception encountered during email transport stream:", err);
    return { data: null, error: err };
  }
}
