import type { Env } from "./env";

const FROM_NAME = "Kabooly Marketing";

// Cloudflare Email Sending (the EMAIL binding). Only two emails ever go
// out: the verification code and the password reset code.
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  await env.EMAIL.send({
    from: { email: env.EMAIL_FROM, name: FROM_NAME },
    to,
    subject,
    text,
  });
}
