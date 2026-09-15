import { beforeEach, describe, expect, it } from "vitest";
import type { AdvertJson, ImageJson } from "../src/advert-store";
import { decodeCursor } from "../src/advert-store";
import type { GenerationEvent } from "../src/generation";
import { ANTHROPIC_URL, GEMINI_URL, geminiImage, mockClaude, mockGemini } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockResend, testEnv, uploadLogo, verifiedUser, withProfile } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockResend();
  mockClaude();
  mockGemini();
});

async function readyUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const { cookie } = await verifiedUser();
  await withProfile(cookie, overrides);
  return cookie;
}

async function generate(cookie: string, topic: string, platforms: string[]): Promise<Response> {
  return apiFetch(cookie, "/api/generations", { method: "POST", body: { topic, platforms } });
}

async function events(res: Response): Promise<GenerationEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GenerationEvent);
}

async function generateAdvert(cookie: string, platforms: string[] = ["instagram"]): Promise<AdvertJson> {
  const list = await events(await generate(cookie, "Spring ovens", platforms));
  const first = list[0];
  if (first?.type !== "advert") throw new Error("no advert event");
  return first.advert;
}

describe("topic suggestion", () => {
  it("needs a business profile first", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: {} });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_profile" });
  });

  it("suggests a topic from the profile, avoiding earlier ones", async () => {
    const cookie = await readyUser();
    const res = await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: { avoid: ["Old idea"] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ topic: "Spring oven cleaning" });
    expect(callsTo(ANTHROPIC_URL).at(-1)?.body).toContain("Old idea");
  });

  it("answers 502 when the model fails, and releases the lock", async () => {
    const cookie = await readyUser();
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 400 }));
    const res = await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: {} });
    expect(res.status).toBe(502);
    mockClaude();
    expect((await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: {} })).status).toBe(200);
  });

  it("validates the body", async () => {
    const cookie = await readyUser();
    const res = await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: { avoid: "x" } });
    expect(res.status).toBe(400);
  });
});

describe("generation", () => {
  it("streams the advert text, then one labelled image per ticked platform", async () => {
    const cookie = await readyUser();
    const res = await generate(cookie, "Spring ovens", ["instagram", "facebook", "instagram"]);
    expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
    const list = await events(res);
    expect(list.map((e) => e.type)).toEqual(["advert", "image", "image", "done"]);
    const advert = list[0]?.type === "advert" ? list[0].advert : null;
    expect(advert).toMatchObject({ topic: "Spring ovens", images: [] });
    expect(advert?.body).toContain("oven clean");
    const images = list.flatMap((e) => (e.type === "image" ? [e.image] : []));
    expect(images.map((i) => i.platform).sort()).toEqual(["facebook", "instagram"]);
    const facebook = images.find((i) => i.platform === "facebook");
    expect(facebook).toMatchObject({ label: "Facebook", width: 1200, height: 630 });
    expect(facebook?.downloadUrl).toMatch(/\?download=kabooly-facebook-\d{4}-\d{2}-\d{2}\.jpg$/);
    expect(list.at(-1)).toMatchObject({ type: "done", usage: { imagesUsed: 2, imagesLimit: 20, nextFreeAt: null } });

    const served = await apiFetch(cookie, facebook?.url ?? "");
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
    await served.arrayBuffer();
  });

  it("sends the profile logo to Gemini when there is one", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    await generateAdvert(cookie, ["nextdoor"]);
    expect(callsTo(GEMINI_URL).at(-1)?.body).toContain('"mime_type":"image/png"');
  });

  it("carries on without a logo whose file has gone", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    await testEnv.FILES.delete(key);
    const list = await events(await generate(cookie, "Spring", ["instagram"]));
    expect(list.map((e) => e.type)).toEqual(["advert", "image", "done"]);
    expect(callsTo(GEMINI_URL).at(-1)?.body).not.toContain("image/png");
  });

  it("makes a text-only advert when no platform is ticked", async () => {
    const cookie = await readyUser();
    const list = await events(await generate(cookie, "Spring", []));
    expect(list.map((e) => e.type)).toEqual(["advert", "done"]);
    expect(callsTo(GEMINI_URL)).toHaveLength(0);
  });

  it("reports a failed image and refunds it", async () => {
    const cookie = await readyUser();
    onFetch(GEMINI_URL, () => new Response("nope", { status: 500 }));
    const list = await events(await generate(cookie, "Spring", ["instagram"]));
    expect(list.map((e) => e.type)).toEqual(["advert", "image_error", "done"]);
    expect(list[1]).toMatchObject({ platform: "instagram", error: "This image could not be made. Try regenerating it." });
    expect(list.at(-1)).toMatchObject({ usage: { imagesUsed: 0 } });
  });

  it("reports failed text without saving anything", async () => {
    const cookie = await readyUser();
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 400 }));
    const list = await events(await generate(cookie, "Spring", ["instagram"]));
    expect(list.map((e) => e.type)).toEqual(["error", "done"]);
    const library: { adverts: unknown[] } = await (await apiFetch(cookie, "/api/adverts")).json();
    expect(library.adverts).toHaveLength(0);
  });

  it("refuses a second generation while one is running", async () => {
    const cookie = await readyUser();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    onFetch(GEMINI_URL, async () => {
      await gate;
      return Response.json(geminiImage());
    });
    // The response headers arrive once the generation holds the lock; its
    // image is then parked on the gate.
    const first = await generate(cookie, "Spring", ["instagram"]);
    const second = await generate(cookie, "Summer", ["instagram"]);
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ code: "busy" });
    release();
    await events(first);
  });

  it("limits image generations per minute", async () => {
    const cookie = await readyUser();
    for (let i = 0; i < 5; i++) {
      await events(await generate(cookie, `Topic ${i}`, ["instagram"]));
    }
    const res = await generate(cookie, "One more", ["instagram"]);
    expect(res.status).toBe(429);
    const body: { code: string; retryAt: string } = await res.json();
    expect(body.code).toBe("rate_limit");
    expect(Date.parse(body.retryAt)).toBeGreaterThan(Date.now());
  });

  it("explains the daily image limit with the time it frees up", async () => {
    const cookie = await readyUser();
    const stub = await limiterFor(cookie);
    const start = Date.now() - 60 * 60_000;
    for (let i = 0; i < 7; i++) {
      const at = start + i * 2 * 60_000;
      const lease = await stub.begin("image", i < 6 ? 3 : 2, at);
      if (lease.ok) await stub.finish(lease.leaseId, 3, at);
    }
    const freeAt = new Date(start + 24 * 60 * 60_000).toISOString();
    const usage: unknown = await (await apiFetch(cookie, "/api/usage")).json();
    expect(usage).toEqual({ imagesUsed: 20, imagesLimit: 20, nextFreeAt: freeAt });
    const res = await generate(cookie, "One more", ["instagram", "facebook", "nextdoor"]);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Daily limit reached.",
      code: "daily_image_limit",
      limit: 20,
      remaining: 0,
      nextFreeAt: freeAt,
    });
  });

  it("explains the daily text limit", async () => {
    const cookie = await readyUser();
    const stub = await limiterFor(cookie);
    const start = Date.now() - 23 * 60 * 60_000;
    for (let i = 0; i < 200; i++) {
      const lease = await stub.begin("text", 0, start + i * 60_000);
      if (lease.ok) await stub.finish(lease.leaseId, 0, start + i * 60_000);
    }
    const res = await apiFetch(cookie, "/api/topics/suggest", { method: "POST", body: {} });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "daily_text_limit", limit: 200, remaining: 0 });
  });

  it("validates the body and needs a profile", async () => {
    const cookie = await readyUser();
    expect((await generate(cookie, "", ["instagram"])).status).toBe(400);
    expect((await generate(cookie, "x", ["tiktok"])).status).toBe(400);
    const { cookie: fresh } = await verifiedUser();
    expect((await generate(fresh, "x", [])).status).toBe(409);
  });
});

describe("library", () => {
  it("lists adverts newest first with their images, a page at a time", async () => {
    const cookie = await readyUser();
    for (let i = 0; i < 13; i++) {
      await testEnv.DB.prepare(
        "INSERT INTO adverts (id, user_id, topic, body, created_at, updated_at) SELECT ?1, user_id, ?2, 'Body', ?3, ?3 FROM business_profiles WHERE business_name = 'Acme Cleaning' AND user_id IN (SELECT user_id FROM session WHERE token = ?4)"
      )
        .bind(`seed-${String(i).padStart(2, "0")}`, `Topic ${i}`, 1_760_000_000 + Math.floor(i / 2), sessionToken(cookie))
        .run();
    }
    const advert = await generateAdvert(cookie, ["facebook"]);

    const first: { adverts: AdvertJson[]; nextCursor: string | null } = await (await apiFetch(cookie, "/api/adverts")).json();
    expect(first.adverts).toHaveLength(12);
    expect(first.adverts[0]?.id).toBe(advert.id);
    expect(first.adverts[0]?.images.map((i: ImageJson) => i.platform)).toEqual(["facebook"]);
    expect(first.adverts[1]?.id).toBe("seed-12");
    expect(first.adverts[2]?.id).toBe("seed-11");
    expect(first.adverts[3]?.id).toBe("seed-10");
    expect(first.nextCursor).not.toBeNull();

    const second: { adverts: AdvertJson[]; nextCursor: string | null } = await (
      await apiFetch(cookie, `/api/adverts?before=${first.nextCursor ?? ""}`)
    ).json();
    expect(second.adverts.map((a) => a.id)).toEqual(["seed-01", "seed-00"]);
    expect(second.nextCursor).toBeNull();
  });

  it("never shows another account's adverts", async () => {
    const owner = await readyUser();
    const advert = await generateAdvert(owner, []);
    const { cookie: other } = await verifiedUser();
    const list: { adverts: unknown[] } = await (await apiFetch(other, "/api/adverts")).json();
    expect(list.adverts).toHaveLength(0);
    expect((await apiFetch(other, `/api/adverts/${advert.id}`)).status).toBe(404);
  });

  it("ignores a malformed cursor", () => {
    expect(decodeCursor("nope")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("1760000000000_abc")).toEqual({ createdAt: new Date(1_760_000_000_000), id: "abc" });
  });

  it("returns one advert with its images in platform order", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, ["nextdoor", "instagram", "facebook"]);
    const res: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/adverts/${advert.id}`)).json();
    expect(res.advert.images.map((i) => i.platform)).toEqual(["instagram", "facebook", "nextdoor"]);
  });
});

async function limiterFor(cookie: string) {
  const session: { user: { id: string } } = await (await apiFetch(cookie, "/api/auth/get-session")).json();
  return testEnv.LIMITER.get(testEnv.LIMITER.idFromName(session.user.id));
}

function sessionToken(cookie: string): string {
  return decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0] ?? "";
}

describe("editing and regenerating", () => {
  it("saves edited text", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, []);
    const res = await apiFetch(cookie, `/api/adverts/${advert.id}`, { method: "PATCH", body: { body: " My own words " } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ advert: { body: "My own words" } });
    const bad = await apiFetch(cookie, `/api/adverts/${advert.id}`, { method: "PATCH", body: { body: "" } });
    expect(bad.status).toBe(400);
    const missing = await apiFetch(cookie, "/api/adverts/nope", { method: "PATCH", body: { body: "x" } });
    expect(missing.status).toBe(404);
  });

  it("regenerates the text only", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, ["instagram"]);
    mockClaude("A brand new advert.");
    const res = await apiFetch(cookie, `/api/adverts/${advert.id}/text`, { method: "POST" });
    expect(res.status).toBe(200);
    const body: { advert: AdvertJson } = await res.json();
    expect(body.advert.body).toBe("A brand new advert.");
    expect(body.advert.images).toHaveLength(1);
    expect((await apiFetch(cookie, "/api/adverts/nope/text", { method: "POST" })).status).toBe(404);
  });

  it("regenerates one platform image, replacing the old file", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, ["instagram", "facebook"]);
    const before: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/adverts/${advert.id}`)).json();
    const oldInstagram = before.advert.images.find((i) => i.platform === "instagram");
    const oldFacebook = before.advert.images.find((i) => i.platform === "facebook");

    const res = await apiFetch(cookie, `/api/adverts/${advert.id}/images/instagram`, { method: "POST" });
    expect(res.status).toBe(200);
    const { image }: { image: ImageJson } = await res.json();
    expect(image.platform).toBe("instagram");
    expect(image.url).not.toBe(oldInstagram?.url);
    expect(await testEnv.FILES.head(oldInstagram?.url.replace("/api/files/", "") ?? "")).toBeNull();

    const after: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/adverts/${advert.id}`)).json();
    expect(after.advert.images.find((i) => i.platform === "facebook")?.url).toBe(oldFacebook?.url);
    const usage: { imagesUsed: number } = await (await apiFetch(cookie, "/api/usage")).json();
    expect(usage.imagesUsed).toBe(3);
  });

  it("answers 502 for a failed regeneration and does not count it", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, []);
    onFetch(GEMINI_URL, () => new Response("down", { status: 503 }));
    const res = await apiFetch(cookie, `/api/adverts/${advert.id}/images/facebook`, { method: "POST" });
    expect(res.status).toBe(502);
    const usage: { imagesUsed: number } = await (await apiFetch(cookie, "/api/usage")).json();
    expect(usage.imagesUsed).toBe(0);
  });

  it("needs the business profile to regenerate", async () => {
    const cookie = await readyUser();
    const advert = await generateAdvert(cookie, []);
    await testEnv.DB.prepare("DELETE FROM business_profiles WHERE user_id = (SELECT user_id FROM adverts WHERE id = ?1)")
      .bind(advert.id)
      .run();
    expect((await apiFetch(cookie, `/api/adverts/${advert.id}/text`, { method: "POST" })).status).toBe(409);
    expect((await apiFetch(cookie, `/api/adverts/${advert.id}/images/facebook`, { method: "POST" })).status).toBe(409);
  });

  it("sends a logo stored without a content type as PNG", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    const object = await testEnv.FILES.get(key);
    await testEnv.FILES.put(key, await object?.arrayBuffer() ?? new ArrayBuffer(0));
    const advert = await generateAdvert(cookie, []);
    await apiFetch(cookie, `/api/adverts/${advert.id}/images/instagram`, { method: "POST" });
    expect(callsTo(GEMINI_URL).at(-1)?.body).toContain('"mime_type":"image/png"');
  });

  it("rejects unknown platforms and adverts", async () => {
    const cookie = await readyUser();
    expect((await apiFetch(cookie, "/api/adverts/x/images/tiktok", { method: "POST" })).status).toBe(404);
    expect((await apiFetch(cookie, "/api/adverts/x/images/facebook", { method: "POST" })).status).toBe(404);
  });
});

describe("usage", () => {
  it("reports images used against the daily limit", async () => {
    const cookie = await readyUser();
    const res = await apiFetch(cookie, "/api/usage");
    expect(await res.json()).toEqual({ imagesUsed: 0, imagesLimit: 20, nextFreeAt: null });
  });
});
