import { NextResponse } from "next/server";
import crypto from "crypto";
import { sendEmail } from "@/lib/mail";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body;

    // 1. Basic input validation
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 2. Generate a secure, URL-safe random token natively via Web Crypto API
    const token = crypto.randomBytes(32).toString("hex");

    // 3. Construct the deep link pointing back to your update password UI page
    const domain = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetLink = `${domain}/auth/new-password?token=${token}`;

    // 4. Route the payload through your new Resend client wrapper helper
    const { error } = await sendEmail({
      to: normalizedEmail,
      subject: "Reset your Pink Raft password",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #ec4899; font-size: 24px; margin-bottom: 16px;">Password Reset Request</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.5;">We received a request to reset your password for your Pink Raft account.</p>
          <p style="color: #374151; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">Click the action button below to set up a new password. This secure link is valid for 1 hour.</p>
          <div style="margin: 24px 0;">
            <a href="${resetLink}" style="background-color: #ec4899; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
            If you did not make this request, you can safely ignore this communication.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("Resend API communication failure:", error);
      return NextResponse.json(
        { error: "Failed to process transactional authentication email." },
        { status: 500 },
      );
    }

    // Always return success to complete the flow gracefully
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("PASSWORD_RESET_ROUTE_EXCEPTION:", error);
    return NextResponse.json({ error: "Internal server error encountered." }, { status: 500 });
  }
}
