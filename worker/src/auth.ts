import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { sendEmail } from "./email";
import type { Env } from "./env";

// Same shape as TrackShows (onnext/worker/src/auth.ts): email + password
// with 6-digit emailed codes for verification and password reset, Google as
// the alternative, and Google linking into a verified email account.
// Nobody can register here: accounts are created only by the kabooly.com
// checkout (provision.ts), so every sign-up path is switched off.
export function createAuth(env: Env) {
  const db = drizzle(env.DB, { schema });
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [
      emailOTP({
        disableSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          // "sign-in" codes are unused; sending nothing disables that flow.
          if (type === "forget-password") {
            await sendEmail(
              env,
              email,
              "Your Kabooly Marketing password reset code",
              `Your Kabooly Marketing password reset code is ${otp}\n\nIt expires in 5 minutes. If you did not ask for this, you can ignore it.`
            );
          }
          if (type === "email-verification") {
            await sendEmail(
              env,
              email,
              "Your Kabooly Marketing verification code",
              `Your Kabooly Marketing verification code is ${otp}\n\nEnter it to verify your email. It expires in 5 minutes. If you did not ask for this, you can ignore it.`
            );
          }
        },
      }),
    ],
    // The app and API share one origin; the Vite dev server proxies /api.
    trustedOrigins: [env.BETTER_AUTH_URL, "http://localhost:5173"],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // Google signs in to an existing account only, never creates one.
        disableSignUp: true,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        // A Google sign-in whose (verified) email matches an existing
        // verified account signs into that account instead of duplicating it.
        trustedProviders: ["google"],
      },
    },
  });
}
