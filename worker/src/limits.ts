import type { Context } from "hono";
import type { Env } from "./env";
import type { Admission, GenerationKind, Usage } from "./limiter";

function limiter(env: Env, userId: string) {
  return env.LIMITER.get(env.LIMITER.idFromName(userId));
}

export interface Lease {
  finish: (imagesMade: number) => Promise<void>;
}

export type Denied = Exclude<Admission, { ok: true }>;

export interface GenerationRequest {
  kind: GenerationKind;
  images: number;
  // False only for topic suggestions (see GenerationLimiter.begin).
  holdLock: boolean;
}

export async function beginGeneration(
  env: Env,
  userId: string,
  request: GenerationRequest
): Promise<Lease | Denied> {
  const stub = limiter(env, userId);
  const admission = await stub.begin(request.kind, request.images, undefined, request.holdLock);
  if (!admission.ok) return admission;
  return {
    finish: async (imagesMade) => {
      await stub.finish(admission.leaseId, imagesMade);
    },
  };
}

export function isDenied(result: Lease | Denied): result is Denied {
  return "reason" in result;
}

export async function usageFor(env: Env, userId: string): Promise<Usage> {
  return limiter(env, userId).usage();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface UsageJson {
  imagesUsed: number;
  imagesLimit: number;
  nextFreeAt: string | null;
}

export function usageJson(usage: Usage): UsageJson {
  return {
    imagesUsed: usage.imagesUsed,
    imagesLimit: usage.imagesLimit,
    nextFreeAt: usage.nextFreeAt === null ? null : iso(usage.nextFreeAt),
  };
}

// 429 with enough detail for the app to explain the limit in local time.
export function deniedResponse(c: Context, denied: Denied): Response {
  switch (denied.reason) {
    case "busy":
      return c.json(
        { error: "A generation is already running. Wait for it to finish.", code: "busy" },
        429
      );
    case "rate":
      return c.json(
        { error: "Too many generations in a minute.", code: "rate_limit", retryAt: iso(denied.retryAt) },
        429
      );
    case "daily":
      return c.json(
        {
          error: "Daily limit reached.",
          code: denied.kind === "image" ? "daily_image_limit" : "daily_text_limit",
          limit: denied.limit,
          remaining: denied.remaining,
          nextFreeAt: iso(denied.nextFreeAt),
        },
        429
      );
  }
}
