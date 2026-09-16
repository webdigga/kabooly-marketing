import { sendEmail } from "./email";
import type { Env } from "./env";

// Anyone can register today, so every new account is worth knowing about.
export async function notifyFounderOfSignup(env: Env, email: string): Promise<void> {
  if (email.toLowerCase() === env.FOUNDER_EMAIL.toLowerCase()) return;
  try {
    await sendEmail(
      env,
      env.FOUNDER_EMAIL,
      "New Kabooly Marketing signup",
      `${email} just registered at marketing.kabooly.com.`
    );
  } catch (err) {
    // Never let the alert stop someone registering.
    console.error("signup alert failed", err);
  }
}
