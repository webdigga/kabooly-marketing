import type { Env } from "./env";

const RESEND_URL = "https://api.resend.com/emails";

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  text: string
): Promise<void> {
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Email send failed with status ${res.status}`);
}
