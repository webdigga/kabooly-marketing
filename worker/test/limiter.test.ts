import { describe, expect, it } from "vitest";
import { imagesFreeAt, LIMITS } from "../src/limiter";
import type { UsageEvent } from "../src/limiter";
import { testEnv } from "./helpers";

const T0 = Date.UTC(2026, 8, 15, 9, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function limiter() {
  return testEnv.LIMITER.get(testEnv.LIMITER.newUniqueId());
}

type Stub = ReturnType<typeof limiter>;

async function run(stub: Stub, kind: "image" | "text", images: number, at: number) {
  return runMaking(stub, { kind, images, at, made: images });
}

async function runMaking(
  stub: Stub,
  job: { kind: "image" | "text"; images: number; at: number; made: number }
) {
  const admission = await stub.begin(job.kind, job.images, job.at);
  if (admission.ok) await stub.finish(admission.leaseId, job.made, job.at);
  return admission;
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

  it("lets a topic suggestion through while a generation runs, without taking the lock", async () => {
    const stub = limiter();
    const generation = await stub.begin("image", 1, T0);
    const suggestion = await stub.begin("text", 0, T0 + 1, false);
    expect(suggestion.ok).toBe(true);
    if (generation.ok) await stub.finish(generation.leaseId, 1, T0 + 2);
    const again = await stub.begin("text", 0, T0 + 3, false);
    expect((await stub.begin("image", 1, T0 + 4)).ok).toBe(true);
    if (suggestion.ok && again.ok) await stub.finish(suggestion.leaseId, 0, T0 + 5);
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

  it("limits text generations separately and more generously", async () => {
    const stub = limiter();
    for (let i = 0; i < 5; i++) await run(stub, "image", 1, T0 + i);
    for (let i = 0; i < LIMITS.textPerMinute; i++) {
      expect((await run(stub, "text", 0, T0 + 100 + i)).ok).toBe(true);
    }
    expect(await run(stub, "text", 0, T0 + 200)).toMatchObject({ ok: false, reason: "rate" });
  });
});

describe("daily image cap", () => {
  it("caps images at 20 per rolling 24 hours and says when the next frees up", async () => {
    const stub = limiter();
    for (let i = 0; i < 5; i++) await run(stub, "image", 3, T0 + i * MINUTE);
    for (let i = 0; i < 5; i++) await run(stub, "image", 1, T0 + (10 + i) * MINUTE);
    expect(await stub.usage(T0 + 20 * MINUTE)).toEqual({ imagesUsed: 20, imagesLimit: 20, nextFreeAt: T0 + DAY });

    const denied = await run(stub, "image", 3, T0 + 30 * MINUTE);
    expect(denied).toEqual({
      ok: false,
      reason: "daily",
      kind: "image",
      limit: 20,
      remaining: 0,
      nextFreeAt: T0 + DAY,
    });
    expect((await run(stub, "image", 3, T0 + DAY)).ok).toBe(true);
  });

  it("tells the user how many are left when a request does not fit", async () => {
    const stub = limiter();
    for (let i = 0; i < 6; i++) await run(stub, "image", 3, T0 + i * MINUTE);
    expect(await run(stub, "image", 3, T0 + 10 * MINUTE)).toMatchObject({ reason: "daily", remaining: 2 });
    expect((await run(stub, "image", 2, T0 + 11 * MINUTE)).ok).toBe(true);
  });

  it("refunds images that failed", async () => {
    const stub = limiter();
    await runMaking(stub, { kind: "image", images: 3, at: T0, made: 1 });
    expect((await stub.usage(T0 + 1)).imagesUsed).toBe(1);
    expect((await stub.usage(T0 + 1)).nextFreeAt).toBeNull();
  });

  it("forgets usage older than a day", async () => {
    const stub = limiter();
    await run(stub, "image", 3, T0);
    expect((await stub.usage(T0 + DAY + 1)).imagesUsed).toBe(0);
  });

  it("works out when enough images age out", () => {
    const events: UsageEvent[] = [
      { id: "a", at: T0, kind: "image", images: 10 },
      { id: "b", at: T0 + 1, kind: "text", images: 0 },
      { id: "c", at: T0 + 2, kind: "image", images: 10 },
    ];
    expect(imagesFreeAt(events, 1, T0)).toBe(T0 + DAY);
    expect(imagesFreeAt(events, 11, T0)).toBe(T0 + 2 + DAY);
    expect(imagesFreeAt([], 1, T0)).toBe(T0);
  });
});

describe("daily text cap", () => {
  it("caps text work at a generous daily number", async () => {
    const stub = limiter();
    for (let i = 0; i < LIMITS.textPerDay; i++) await run(stub, "text", 0, T0 + i * MINUTE);
    const denied = await run(stub, "text", 0, T0 + LIMITS.textPerDay * MINUTE);
    expect(denied).toEqual({
      ok: false,
      reason: "daily",
      kind: "text",
      limit: LIMITS.textPerDay,
      remaining: 0,
      nextFreeAt: T0 + DAY,
    });
  });
});
