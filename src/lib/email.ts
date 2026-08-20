import { Resend } from "resend";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";

let resendClient: Resend | null = null;

function client(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new AppError("Email OTP provider is not configured", 503);
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

export async function sendEmailOtp(to: string, code: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  if (!env.RESEND_FROM_EMAIL) {
    throw new AppError("RESEND_FROM_EMAIL is missing", 500);
  }

  const resend = client();
  const subject = "Your NYTO login code";
  const text = `Your NYTO OTP is ${code}. It expires in 5 minutes.`;

  const result = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    text,
    html: `<p>Your NYTO OTP is <strong>${code}</strong>.</p><p>This code expires in 5 minutes.</p>`,
  });

  if (result.error) {
    console.error("[resend]", result.error);
    throw new AppError(
      result.error.message || "Could not send OTP email",
      502,
    );
  }

  console.log(`[resend] OTP emailed to ${to}`);
}
