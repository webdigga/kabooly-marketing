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
  // Where new signup alerts go.
  FOUNDER_EMAIL: string;
  ANTHROPIC_API_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_IMAGE_MODEL: string;
}
