import type { Context } from "hono";
import type { Env } from "./env";
import type { Admission, Allowance, GenerationKind, Usage } from "./limiter";

function limiter(env: Env, userId: string) {
  return env.LIMITER.get(env.LIMITER.idFromName(userId));
}

export interface Lease {
  // Kept by work that finishes in a later request (videos).
  id: string;
  finish: (unitsMade: number) => Promise<void>;
}

export type Denied = Exclude<Admission, { ok: true }>;

export interface GenerationRequest {
  kind: GenerationKind;
  // Images or videos the work will make; ignored for text.
  units: number;
  // False for work that must not wait for or take the in-flight lock (see
  // GenerationLimiter.begin).
  holdLock: boolean;
}

export async function beginGeneration(
  env: Env,
  userId: string,
  request: GenerationRequest
): Promise<Lease | Denied> {
  const stub = limiter(env, userId);
  const admission = await stub.begin(request.kind, request.units, undefined, request.holdLock);
  if (!admission.ok) return admission;
  return leaseFor(env, userId, admission.leaseId);
}

// A lease picked up again by id, for work that outlives its first request.
export function leaseFor(env: Env, userId: string, leaseId: string): Lease {
  return {
    id: leaseId,
    finish: async (unitsMade) => {
      await limiter(env, userId).finish(leaseId, unitsMade);
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

export interface AllowanceJson {
  used: number;
  limit: number;
  nextFreeAt: string | null;
}

export interface UsageJson {
  imagesToday: AllowanceJson;
  imagesThisMonth: AllowanceJson;
  videosThisMonth: AllowanceJson;
}

function allowanceJson(allowance: Allowance): AllowanceJson {
  return {
    used: allowance.used,
    limit: allowance.limit,
    nextFreeAt: allowance.nextFreeAt === null ? null : iso(allowance.nextFreeAt),
  };
}

export function usageJson(usage: Usage): UsageJson {
  return {
    imagesToday: allowanceJson(usage.imagesToday),
    imagesThisMonth: allowanceJson(usage.imagesThisMonth),
    videosThisMonth: allowanceJson(usage.videosThisMonth),
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
    case "allowance":
      return c.json(
        {
          error: denied.window === "day" ? "Daily limit reached." : "Monthly limit reached.",
          // daily_image_limit, monthly_image_limit, monthly_video_limit,
          // daily_text_limit.
          code: `${denied.window === "day" ? "daily" : "monthly"}_${denied.kind}_limit`,
          limit: denied.limit,
          remaining: denied.remaining,
          nextFreeAt: iso(denied.nextFreeAt),
        },
        429
      );
  }
}
