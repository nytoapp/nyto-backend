import { Resend } from "resend";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { maskEmail } from "./phone";

let resendClient: Resend | null = null;

export type EmailDeliveryMode = "resend" | "dev_log" | "skipped_test";

export type EmailDeliveryResult = {
  /** True only when Resend accepted the message. */
  delivered: boolean;
  mode: EmailDeliveryMode;
};

export function isTransactionalEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM_EMAIL?.trim());
}

function client(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new AppError("Email provider is not configured", 503);
  }
  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailDeliveryResult> {
  if (!isTransactionalEmailConfigured()) {
    console.log(
      `[email:dev] "${opts.subject}" for ${maskEmail(opts.to)} (not delivered)`,
    );
    return { delivered: false, mode: "dev_log" };
  }

  const result = await client().emails.send({
    from: env.RESEND_FROM_EMAIL!,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });

  if (result.error) {
    console.error("[resend] delivery failed", result.error.name);
    throw new AppError("Could not send email right now", 502);
  }

  return { delivered: true, mode: "resend" };
}

export async function sendEmailOtp(
  to: string,
  code: string,
): Promise<EmailDeliveryResult> {
  return sendMail({
    to,
    subject: "Your NYTO login code",
    text: `Your NYTO OTP is ${code}. It expires in 5 minutes.`,
    html: `<p>Your NYTO OTP is <strong>${code}</strong>.</p><p>This code expires in 5 minutes.</p>`,
  });
}

/** Sent after admin approves a host — only when Resend is configured. */
export async function sendHostPortalReadyEmail(opts: {
  to: string;
  contactName: string;
  venueName: string;
  portalUrl: string;
}): Promise<EmailDeliveryResult> {
  const name = opts.contactName.trim() || "there";
  const subject = `You're approved — ${opts.venueName} on NYTO`;
  const text = [
    `Hi ${name},`,
    "",
    `Your NYTO host application for ${opts.venueName} is approved.`,
    `Sign in to the venue portal with this email (OTP login):`,
    opts.portalUrl,
    "",
    "No separate invite link — use email OTP at the portal.",
    "",
    "— NYTO",
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your NYTO host application for <strong>${escapeHtml(opts.venueName)}</strong> is approved.</p>
    <p>Sign in to the venue portal with this email (OTP login):<br/>
    <a href="${escapeHtml(opts.portalUrl)}">${escapeHtml(opts.portalUrl)}</a></p>
    <p>No separate invite link — use email OTP at the portal.</p>
    <p>— NYTO</p>
  `;
  return sendMail({ to: opts.to, subject, text, html });
}

/** Optional notice after team invite — access is role grant + OTP, not a magic link. */
export async function sendAdminInviteEmail(opts: {
  to: string;
  name: string;
  consoleUrl: string;
}): Promise<EmailDeliveryResult> {
  const name = opts.name.trim() || "there";
  const subject = "NYTO Admin access";
  const text = [
    `Hi ${name},`,
    "",
    "You've been granted NYTO Admin console access.",
    `Sign in with this email (OTP): ${opts.consoleUrl}`,
    "",
    "— NYTO",
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>You've been granted NYTO Admin console access.</p>
    <p>Sign in with this email (OTP):<br/>
    <a href="${escapeHtml(opts.consoleUrl)}">${escapeHtml(opts.consoleUrl)}</a></p>
    <p>— NYTO</p>
  `;
  return sendMail({ to: opts.to, subject, text, html });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
