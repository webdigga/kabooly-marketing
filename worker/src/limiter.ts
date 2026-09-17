import { DurableObject } from "cloudflare:workers";

// One instance per account (idFromName(userId)). A Durable Object runs one
// request at a time, so check-then-record can never race: parallel requests
// cannot all slip under a limit or both take the in-flight lock.

export const LIMITS = {
  // Images per account in any rolling 24 hours and any rolling 30 days
  // (regenerations included). A carousel counts as one image.
  imagesPerDay: 20,
  imagesPerMonth: 150,
  // Generations that make images, per rolling minute.
  imageGenerationsPerMinute: 5,
  // Videos per account in any rolling 30 days, and per rolling minute.
  videosPerMonth: 20,
  videosPerMinute: 3,
  // Text-only work (topic suggestions, text regeneration, image-free adverts,
  // own-photo posts, website reads).
  textPerDay: 200,
  textPerMinute: 20,
  // A generation that never reports back releases its lock after this.
  lockTtlMs: 5 * 60_000,
} as const;

const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
export const MONTH_MS = 30 * DAY_MS;

export type GenerationKind = "image" | "text" | "video";

export interface UsageEvent {
  id: string;
  at: number;
  kind: GenerationKind;
  // Units the event still counts: images for "image", videos for "video",
  // zero for "text". Failed units are refunded by finish().
  units: number;
}

interface LimiterState {
  events: UsageEvent[];
  lock: { id: string; expiresAt: number } | null;
}

export type Window = "day" | "month";

export type Admission =
  | { ok: true; leaseId: string }
  | { ok: false; reason: "busy" }
  | { ok: false; reason: "rate"; retryAt: number }
  | {
      ok: false;
      reason: "allowance";
      kind: GenerationKind;
      window: Window;
      limit: number;
      remaining: number;
      nextFreeAt: number;
    };

export interface Allowance {
  used: number;
  limit: number;
  // When the next unit frees up, only while the allowance is used up.
  nextFreeAt: number | null;
}

export interface Usage {
  imagesToday: Allowance;
  imagesThisMonth: Allowance;
  videosThisMonth: Allowance;
}

export interface Cap {
  kind: GenerationKind;
  window: Window;
  limit: number;
}

const WINDOW_MS: Record<Window, number> = { day: DAY_MS, month: MONTH_MS };

export const IMAGES_DAY: Cap = { kind: "image", window: "day", limit: LIMITS.imagesPerDay };
export const IMAGES_MONTH: Cap = { kind: "image", window: "month", limit: LIMITS.imagesPerMonth };
export const VIDEOS_MONTH: Cap = { kind: "video", window: "month", limit: LIMITS.videosPerMonth };
export const TEXT_DAY: Cap = { kind: "text", window: "day", limit: LIMITS.textPerDay };

// Every allowance a kind of work must fit, tightest window first.
const CAPS: Record<GenerationKind, Cap[]> = {
  image: [IMAGES_DAY, IMAGES_MONTH],
  video: [VIDEOS_MONTH],
  text: [TEXT_DAY],
};

// Units an event uses up: text work counts one per event.
function unitsOf(event: UsageEvent): number {
  return event.kind === "text" ? 1 : event.units;
}

function inWindow(events: UsageEvent[], cap: Cap, now: number): UsageEvent[] {
  const since = now - WINDOW_MS[cap.window];
  return events.filter((e) => e.kind === cap.kind && e.at > since);
}

function unitsIn(events: UsageEvent[]): number {
  return events.reduce((sum, e) => sum + unitsOf(e), 0);
}

// When enough units age out of the window to fit `wanted` more. Walking
// newest first, the first event that no longer fits alongside the newer
// ones must expire, and with it everything older.
export function freeAt(events: UsageEvent[], cap: Cap, wanted: number, now: number): number {
  const budget = cap.limit - wanted;
  let kept = 0;
  const blocker = inWindow(events, cap, now)
    .filter((e) => unitsOf(e) > 0)
    .sort((a, b) => b.at - a.at)
    .find((e) => {
      kept += unitsOf(e);
      return kept > budget;
    });
  return blocker ? blocker.at + WINDOW_MS[cap.window] : now;
}

function checkRate(events: UsageEvent[], kind: GenerationKind, now: number): Admission | null {
  const perMinute = {
    image: LIMITS.imageGenerationsPerMinute,
    video: LIMITS.videosPerMinute,
    text: LIMITS.textPerMinute,
  }[kind];
  const recent = events.filter((e) => e.kind === kind && e.at > now - MINUTE_MS);
  if (recent.length < perMinute) return null;
  const oldest = Math.min(...recent.map((e) => e.at));
  return { ok: false, reason: "rate", retryAt: oldest + MINUTE_MS };
}

// Text work asks for one unit however it is called.
export function checkAllowance(
  events: UsageEvent[],
  kind: GenerationKind,
  units: number,
  now: number
): Admission | null {
  const wanted = kind === "text" ? 1 : units;
  for (const cap of CAPS[kind]) {
    const used = unitsIn(inWindow(events, cap, now));
    if (used + wanted <= cap.limit) continue;
    return {
      ok: false,
      reason: "allowance",
      kind,
      window: cap.window,
      limit: cap.limit,
      remaining: Math.max(0, cap.limit - used),
      nextFreeAt: freeAt(events, cap, Math.min(wanted, cap.limit), now),
    };
  }
  return null;
}

export function allowance(events: UsageEvent[], cap: Cap, now: number): Allowance {
  const used = unitsIn(inWindow(events, cap, now));
  return {
    used,
    limit: cap.limit,
    nextFreeAt: used >= cap.limit ? freeAt(events, cap, 1, now) : null,
  };
}

export class GenerationLimiter extends DurableObject {
  private async load(now: number): Promise<LimiterState> {
    const state = (await this.ctx.storage.get<LimiterState>("state")) ?? {
      events: [],
      lock: null,
    };
    state.events = state.events.filter((e) => e.at > now - MONTH_MS);
    if (state.lock && state.lock.expiresAt <= now) state.lock = null;
    return state;
  }

  private async save(state: LimiterState): Promise<void> {
    await this.ctx.storage.put("state", state);
  }

  // Admits a generation or says why not. Units (images or videos) are
  // counted up front, so a generation that is abandoned mid-way still
  // counts; finish() refunds the ones that failed. Work passing holdLock
  // false (topic suggestions, website reads, videos, which take minutes)
  // counts towards its caps but neither waits for nor takes the in-flight
  // lock.
  async begin(
    kind: GenerationKind,
    units: number,
    now = Date.now(),
    holdLock = true
  ): Promise<Admission> {
    const state = await this.load(now);
    if (holdLock && state.lock) return { ok: false, reason: "busy" };
    const denied =
      checkRate(state.events, kind, now) ?? checkAllowance(state.events, kind, units, now);
    if (denied) return denied;

    const leaseId = crypto.randomUUID();
    state.events.push({ id: leaseId, at: now, kind, units: kind === "text" ? 0 : units });
    if (holdLock) state.lock = { id: leaseId, expiresAt: now + LIMITS.lockTtlMs };
    await this.save(state);
    return { ok: true, leaseId };
  }

  async finish(leaseId: string, unitsMade: number, now = Date.now()): Promise<void> {
    const state = await this.load(now);
    const event = state.events.find((e) => e.id === leaseId);
    if (event) event.units = Math.min(event.units, unitsMade);
    if (state.lock?.id === leaseId) state.lock = null;
    await this.save(state);
  }

  async usage(now = Date.now()): Promise<Usage> {
    const { events } = await this.load(now);
    return {
      imagesToday: allowance(events, IMAGES_DAY, now),
      imagesThisMonth: allowance(events, IMAGES_MONTH, now),
      videosThisMonth: allowance(events, VIDEOS_MONTH, now),
    };
  }
}
