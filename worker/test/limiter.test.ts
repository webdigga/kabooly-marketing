import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  allowance,
  checkAllowance,
  DAY_MS,
  freeAt,
  IMAGES_DAY,
  IMAGES_MONTH,
  LIMITS,
  MONTH_MS,
  VIDEOS_MONTH,
} from "../src/limiter";
import type { GenerationKind, UsageEvent } from "../src/limiter";
import { testEnv } from "./helpers";

const T0 = Date.UTC(2026, 8, 15, 9, 0, 0);
const MINUTE = 60_000;
const DAY = DAY_MS;

function limiter() {
  return testEnv.LIMITER.get(testEnv.LIMITER.newUniqueId());
}

type Stub = ReturnType<typeof limiter>;

async function run(stub: Stub, kind: GenerationKind, units: number, at: number) {
  return runMaking(stub, { kind, units, at, made: units });
}

async function runMaking(stub: Stub, job: { kind: GenerationKind; units: number; at: number; made: number }) {
  const admission = await stub.begin(job.kind, job.units, job.at);
  if (admission.ok) await stub.finish(admission.leaseId, job.made, job.at);
  return admission;
}

function events(kind: GenerationKind, units: number, count: number, spacing: { start: number; gap: number }): UsageEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${kind}${String(i)}`,
    at: spacing.start + i * spacing.gap,
    kind,
    units,
  }));
}

describe("in-flight lock", () => {
  it("allows one generation at a time and releases on finish", async () => {
    const stub = limiter();
    const first = await stub.begin("image", 1, T0);
    expect(first.ok).toBe(true);
    expect(await stub.begin("text", 0, T0 + 1)).toEqual({ ok: false, reason: "busy" });
    if (first.ok) await stub.finish(first.leaseId, 1, T0 + 2);
    expect((await stub.begin("text", 0, T0 + 3)).ok).toBe(true);
  });

  it("frees a lock that was never finished after its time-to-live", async () => {
    const stub = limiter();
    await stub.begin("image", 1, T0);
    expect((await stub.begin("image", 1, T0 + LIMITS.lockTtlMs - 1)).ok).toBe(false);
    expect((await stub.begin("image", 1, T0 + LIMITS.lockTtlMs)).ok).toBe(true);
  });

  it("lets lock-free work (suggestions, videos) through while a generation runs", async () => {
    const stub = limiter();
    const generation = await stub.begin("image", 1, T0);
    const suggestion = await stub.begin("text", 0, T0 + 1, false);
    const video = await stub.begin("video", 1, T0 + 2, false);
    expect(suggestion.ok && video.ok).toBe(true);
    if (generation.ok) await stub.finish(generation.leaseId, 1, T0 + 3);
    expect((await stub.begin("image", 1, T0 + 4)).ok).toBe(true);
  });

  it("ignores a finish for a lease it does not know", async () => {
    const stub = limiter();
    const lease = await stub.begin("image", 2, T0);
    await stub.finish("unknown", 0, T0);
    expect((await stub.begin("text", 0, T0)).ok).toBe(false);
    if (lease.ok) await stub.finish(lease.leaseId, 2, T0);
  });
});

describe("per-minute rate", () => {
  it("allows five image generations a minute, then says when to retry", async () => {
    const stub = limiter();
    for (let i = 0; i < 5; i++) expect((await run(stub, "image", 1, T0 + i * 1000)).ok).toBe(true);
    expect(await run(stub, "image", 1, T0 + 10_000)).toEqual({ ok: false, reason: "rate", retryAt: T0 + MINUTE });
    expect((await run(stub, "image", 1, T0 + MINUTE)).ok).toBe(true);
  });

  it("limits text and videos separately", async () => {
    const stub = limiter();
    for (let i = 0; i < 5; i++) await run(stub, "image", 1, T0 + i);
    for (let i = 0; i < LIMITS.textPerMinute; i++) {
      expect((await run(stub, "text", 0, T0 + 100 + i)).ok).toBe(true);
    }
    expect(await run(stub, "text", 0, T0 + 200)).toMatchObject({ ok: false, reason: "rate" });
    for (let i = 0; i < LIMITS.videosPerMinute; i++) {
      expect((await run(stub, "video", 1, T0 + 300 + i)).ok).toBe(true);
    }
    expect(await run(stub, "video", 1, T0 + 400)).toMatchObject({ ok: false, reason: "rate" });
  });
});

describe("image allowances", () => {
  it("caps images at 20 per rolling 24 hours and says when the next frees up", async () => {
    const stub = limiter();
    for (let i = 0; i < 5; i++) await run(stub, "image", 3, T0 + i * MINUTE);
    for (let i = 0; i < 5; i++) await run(stub, "image", 1, T0 + (10 + i) * MINUTE);
    const usage = await stub.usage(T0 + 20 * MINUTE);
    expect(usage.imagesToday).toEqual({ used: 20, limit: 20, nextFreeAt: T0 + DAY });
    expect(usage.imagesThisMonth).toEqual({ used: 20, limit: 150, nextFreeAt: null });

    expect(await run(stub, "image", 3, T0 + 30 * MINUTE)).toEqual({
      ok: false,
      reason: "allowance",
      kind: "image",
      window: "day",
      limit: 20,
      remaining: 0,
      nextFreeAt: T0 + DAY,
    });
    expect((await run(stub, "image", 3, T0 + DAY)).ok).toBe(true);
  });

  it("tells the user how many are left when a request does not fit", async () => {
    const stub = limiter();
    for (let i = 0; i < 6; i++) await run(stub, "image", 3, T0 + i * MINUTE);
    expect(await run(stub, "image", 3, T0 + 10 * MINUTE)).toMatchObject({ reason: "allowance", remaining: 2 });
    expect((await run(stub, "image", 2, T0 + 11 * MINUTE)).ok).toBe(true);
  });

  it("caps images at 150 per rolling 30 days", () => {
    // 15 a day for ten days: never over the daily cap, but the month is full.
    const history = events("image", 15, 10, { start: T0, gap: DAY });
    const now = T0 + 10 * DAY;
    expect(checkAllowance(history, "image", 1, now)).toEqual({
      ok: false,
      reason: "allowance",
      kind: "image",
      window: "month",
      limit: 150,
      remaining: 0,
      nextFreeAt: T0 + MONTH_MS,
    });
    expect(allowance(history, IMAGES_MONTH, now)).toEqual({ used: 150, limit: 150, nextFreeAt: T0 + MONTH_MS });
    expect(allowance(history, IMAGES_DAY, now)).toEqual({ used: 0, limit: 20, nextFreeAt: null });
    expect(checkAllowance(history, "image", 1, T0 + MONTH_MS)).toBeNull();
  });

  it("refunds images that failed", async () => {
    const stub = limiter();
    await runMaking(stub, { kind: "image", units: 3, at: T0, made: 1 });
    expect((await stub.usage(T0 + 1)).imagesToday).toEqual({ used: 1, limit: 20, nextFreeAt: null });
  });

  it("forgets usage older than 30 days, and daily usage after a day", async () => {
    const stub = limiter();
    await run(stub, "image", 3, T0);
    const nextDay = await stub.usage(T0 + DAY + 1);
    expect(nextDay.imagesToday.used).toBe(0);
    expect(nextDay.imagesThisMonth.used).toBe(3);
    expect((await stub.usage(T0 + MONTH_MS + 1)).imagesThisMonth.used).toBe(0);
  });

  it("works out when enough images age out", () => {
    const history: UsageEvent[] = [
      { id: "a", at: T0, kind: "image", units: 10 },
      { id: "b", at: T0 + 1, kind: "text", units: 0 },
      { id: "c", at: T0 + 2, kind: "image", units: 10 },
    ];
    expect(freeAt(history, IMAGES_DAY, 1, T0)).toBe(T0 + DAY);
    expect(freeAt(history, IMAGES_DAY, 11, T0)).toBe(T0 + 2 + DAY);
    expect(freeAt([], IMAGES_DAY, 1, T0)).toBe(T0);
  });
});

describe("video allowance", () => {
  it("caps videos at 20 per rolling 30 days, separately from images", async () => {
    const stub = limiter();
    const history = events("video", 1, 20, { start: T0, gap: DAY / 2 });
    const now = T0 + 11 * DAY;
    expect(checkAllowance(history, "video", 1, now)).toMatchObject({
      reason: "allowance",
      kind: "video",
      window: "month",
      limit: 20,
      remaining: 0,
      nextFreeAt: T0 + MONTH_MS,
    });
    expect(checkAllowance(history, "image", 3, now)).toBeNull();
    expect(allowance(history, VIDEOS_MONTH, now).used).toBe(20);

    await runMaking(stub, { kind: "video", units: 1, at: T0, made: 0 });
    await run(stub, "video", 1, T0 + 1);
    expect((await stub.usage(T0 + 2)).videosThisMonth).toEqual({ used: 1, limit: 20, nextFreeAt: null });
  });
});

describe("daily text cap", () => {
  it("caps text work at a generous daily number, whatever units are asked for", () => {
    const history = events("text", 0, LIMITS.textPerDay, { start: T0, gap: MINUTE });
    expect(checkAllowance(history.slice(0, -1), "text", 0, T0)).toBeNull();
    expect(checkAllowance(history, "text", 5, T0)).toEqual({
      ok: false,
      reason: "allowance",
      kind: "text",
      window: "day",
      limit: LIMITS.textPerDay,
      remaining: 0,
      nextFreeAt: T0 + DAY,
    });
  });
});

describe("stored events from before the monthly caps", () => {
  it("reads their old image counts instead of refusing everything", async () => {
    const stub = limiter();
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("state", {
        events: [
          { id: "old-image", at: T0, kind: "image", images: 3 },
          { id: "old-text", at: T0 + 1, kind: "text", images: 0 },
          { id: "odd", at: T0 + 2, kind: "image" },
        ],
        lock: null,
      });
    });
    expect((await stub.usage(T0 + 10)).imagesToday).toEqual({ used: 3, limit: 20, nextFreeAt: null });
    expect((await stub.begin("image", 1, T0 + 20)).ok).toBe(true);
  });
});
