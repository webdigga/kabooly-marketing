import { type EmailContent, renderEmail } from "./email-layout";
import type { Env } from "./env";

const FROM_NAME = "Kabooly Marketing";

// Cloudflare Email Sending (the EMAIL binding). Three emails go out: the
// set-password link for a new customer, the verification code and the
// password reset code. Each is sent as HTML with the Kabooly signature and
// as plain text.
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  content: EmailContent
): Promise<void> {
  await env.EMAIL.send({
    from: { email: env.EMAIL_FROM, name: FROM_NAME },
    to,
    subject,
    ...renderEmail(content),
  });
}
