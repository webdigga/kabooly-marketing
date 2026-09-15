import { DurableObject } from "cloudflare:workers";

// One instance per account (idFromName(userId)). A Durable Object runs one
// request at a time, so check-then-record can never race: parallel requests
// cannot all slip under a limit or both take the in-flight lock.

export const LIMITS = {
  // Images per account in any rolling 24 hours (regenerations included).
  imagesPerDay: 20,
  // Generations that make images, per rolling minute.
  imageGenerationsPerMinute: 5,
  // Text-only work (topic suggestions, text regeneration, image-free adverts).
  textPerDay: 200,
  textPerMinute: 20,
  // A generation that never reports back releases its lock after this.
  lockTtlMs: 5 * 60_000,
} as const;

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

export type GenerationKind = "image" | "text";

export interface UsageEvent {
  id: string;
  at: number;
  kind: GenerationKind;
  images: number;
}

interface LimiterState {
  events: UsageEvent[];
  lock: { id: string; expiresAt: number } | null;
}

export type Admission =
  | { ok: true; leaseId: string }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "rate"; retryAt: number }
  | { ok: false; reason: "daily"; kind: GenerationKind; limit: number; remaining: number; nextFreeAt: number };

export interface Usage {
  imagesUsed: number;
  imagesLimit: number;
  nextFreeAt: number | null;
}

function imagesIn(events: UsageEvent[]): number {
  return events.reduce((sum, e) => sum + e.images, 0);
}

// When enough images age out of the rolling window to fit `wanted` more.
// Walking newest first, the first event that no longer fits alongside the
// newer ones must expire, and with it everything older.
export function imagesFreeAt(events: UsageEvent[], wanted: number, now: number): number {
  const budget = LIMITS.imagesPerDay - wanted;
  let kept = 0;
  const blocker = events
    .filter((e) => e.images > 0)
    .sort((a, b) => b.at - a.at)
    .find((e) => {
      kept += e.images;
      return kept > budget;
    });
  return blocker ? blocker.at + DAY_MS : now;
}

function checkRate(events: UsageEvent[], kind: GenerationKind, now: number): Admission | null {
  const perMinute =
    kind === "image" ? LIMITS.imageGenerationsPerMinute : LIMITS.textPerMinute;
  const recent = events.filter((e) => e.kind === kind && e.at > now - MINUTE_MS);
  if (recent.length < perMinute) return null;
  const oldest = Math.min(...recent.map((e) => e.at));
  return { ok: false, reason: "rate", retryAt: oldest + MINUTE_MS };
}

function checkDaily(
  events: UsageEvent[],
  kind: GenerationKind,
  images: number,
  now: number
): Admission | null {
  if (kind === "image") {
    const used = imagesIn(events);
    if (used + images <= LIMITS.imagesPerDay) return null;
    return {
      ok: false,
      reason: "daily",
      kind,
      limit: LIMITS.imagesPerDay,
      remaining: Math.max(0, LIMITS.imagesPerDay - used),
      nextFreeAt: imagesFreeAt(events, Math.min(images, LIMITS.imagesPerDay), now),
    };
  }
  const texts = events.filter((e) => e.kind === "text");
  if (texts.length < LIMITS.textPerDay) return null;
  return {
    ok: false,
    reason: "daily",
    kind,
    limit: LIMITS.textPerDay,
    remaining: 0,
    nextFreeAt: Math.min(...texts.map((e) => e.at)) + DAY_MS,
  };
}

export class GenerationLimiter extends DurableObject {
  private async load(now: number): Promise<LimiterState> {
    const state = (await this.ctx.storage.get<LimiterState>("state")) ?? {
      events: [],
      lock: null,
    };
    state.events = state.events.filter((e) => e.at > now - DAY_MS);
    if (state.lock && state.lock.expiresAt <= now) state.lock = null;
    return state;
  }

  private async save(state: LimiterState): Promise<void> {
    await this.ctx.storage.put("state", state);
  }

  // Admits a generation or says why not. Images are counted up front, so a
  // generation that is abandoned mid-way still counts; finish() refunds the
  // ones that failed.
  async begin(kind: GenerationKind, images: number, now = Date.now()): Promise<Admission> {
    const state = await this.load(now);
    if (state.lock) return { ok: false, reason: "busy" };
    const denied =
      checkRate(state.events, kind, now) ?? checkDaily(state.events, kind, images, now);
    if (denied) return denied;

    const leaseId = crypto.randomUUID();
    state.events.push({ id: leaseId, at: now, kind, images });
    state.lock = { id: leaseId, expiresAt: now + LIMITS.lockTtlMs };
    await this.save(state);
    return { ok: true, leaseId };
  }

  async finish(leaseId: string, imagesMade: number, now = Date.now()): Promise<void> {
    const state = await this.load(now);
    const event = state.events.find((e) => e.id === leaseId);
    if (event) event.images = Math.min(event.images, imagesMade);
    if (state.lock?.id === leaseId) state.lock = null;
    await this.save(state);
  }

  async usage(now = Date.now()): Promise<Usage> {
    const state = await this.load(now);
    const used = imagesIn(state.events);
    return {
      imagesUsed: used,
      imagesLimit: LIMITS.imagesPerDay,
      nextFreeAt: used >= LIMITS.imagesPerDay ? imagesFreeAt(state.events, 1, now) : null,
    };
  }
}
