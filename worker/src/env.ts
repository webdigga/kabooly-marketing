import type { GenerationLimiter } from "./limiter";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  IMAGES: ImagesBinding;
  LIMITER: DurableObjectNamespace<GenerationLimiter>;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  EMAIL: SendEmail;
  // Bare address on the onboarded sending domain; the display name is set
  // in email.ts.
  EMAIL_FROM: string;
  // Login email of the founder's own account, which works without a subscription.
  FOUNDER_LOGIN_EMAIL: string;
  // Shared with the kabooly.com checkout and the CRM for /api/internal/*.
  INTERNAL_API_SECRET: string;
  // Signing secret of this worker's Stripe webhook endpoint.
  STRIPE_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_IMAGE_MODEL: string;
  GEMINI_VIDEO_MODEL: string;
}
