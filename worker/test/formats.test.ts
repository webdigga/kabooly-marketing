import { beforeEach, describe, expect, it } from "vitest";
import type { AdvertJson, FileJson } from "../src/advert-store";
import type { GenerationEvent } from "../src/generation";
import { ANTHROPIC_URL, GEMINI_URL, geminiImage, mockClaude, mockGemini, SLIDES, STORY_WORDS } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import {
  apiFetch,
  mockEmail,
  photoBytes,
  testEnv,
  uploadLogo,
  uploadPhoto,
  verifiedUser,
  withProfile,
} from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
  mockGemini();
});

async function readyUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const { cookie } = await verifiedUser();
  await withProfile(cookie, overrides);
  return cookie;
}

async function events(res: Response): Promise<GenerationEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GenerationEvent);
}

function generate(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return apiFetch(cookie, "/api/generations", { method: "POST", body: { topic: "Spring ovens", ...body } });
}

async function usage(cookie: string): Promise<{ imagesToday: { used: number } }> {
  return (await apiFetch(cookie, "/api/usage")).json();
}

function keyOf(file: { url: string }): string {
  return file.url.replace("/api/files/", "");
}

describe("own-photo posts", () => {
  async function withLogoAndPhoto(): Promise<{ cookie: string; photoKey: string }> {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    const { key: photoKey }: { key: string } = await (await uploadPhoto(cookie, await photoBytes())).json();
    return { cookie, photoKey };
  }

  it("cuts branded platform images from the photo without Gemini, then drops the photo", async () => {
    const { cookie, photoKey } = await withLogoAndPhoto();
    const list = await events(await generate(cookie, { format: "photo", platforms: ["instagram", "facebook"], photoKey }));
    expect(list.map((e) => e.type)).toEqual(["advert", "image", "image", "done"]);
    expect(list[0]).toMatchObject({ advert: { format: "photo" } });
    expect(callsTo(GEMINI_URL)).toHaveLength(0);
    expect(list.at(-1)).toMatchObject({ usage: { imagesToday: { used: 0 } } });
    expect(await testEnv.FILES.head(photoKey)).toBeNull();

    const advert = list[0]?.type === "advert" ? list[0].advert : null;
    const regenerate = await apiFetch(cookie, `/api/posts/${advert?.id ?? ""}/images/instagram`, { method: "POST" });
    expect(regenerate.status).toBe(400);
    expect(await regenerate.json()).toMatchObject({ code: "not_generated" });
  });

  it("works without a logo or brand colours", async () => {
    const cookie = await readyUser({ brandColours: [] });
    const { key }: { key: string } = await (await uploadPhoto(cookie, await photoBytes())).json();
    const list = await events(await generate(cookie, { format: "photo", platforms: ["nextdoor"], photoKey: key }));
    expect(list.map((e) => e.type)).toEqual(["advert", "image", "done"]);
  });

  it("says to try again when an image cannot be cut", async () => {
    const cookie = await readyUser();
    // In the account's uploads, so it is accepted, but it is not an image.
    const session: { user: { id: string } } = await (await apiFetch(cookie, "/api/auth/get-session")).json();
    const photoKey = `users/${session.user.id}/uploads/broken.jpg`;
    await testEnv.FILES.put(photoKey, "not a photo");
    const list = await events(await generate(cookie, { format: "photo", platforms: ["instagram"], photoKey }));
    expect(list[1]).toMatchObject({ type: "image_error", error: "This image could not be made from your photo. Try again." });
  });

  it("refuses a photo that is missing or belongs to someone else", async () => {
    const { photoKey } = await withLogoAndPhoto();
    const other = await readyUser();
    const stolen = await generate(other, { format: "photo", platforms: ["instagram"], photoKey });
    expect(stolen.status).toBe(400);
    expect(await stolen.json()).toMatchObject({ code: "photo_missing" });
    const gone = await generate(other, { format: "photo", platforms: ["instagram"], photoKey: "users/x/uploads/../y.jpg" });
    expect(gone.status).toBe(400);
    const { cookie } = await withLogoAndPhoto();
    const session: { user: { id: string } } = await (await apiFetch(cookie, "/api/auth/get-session")).json();
    const missing = await generate(cookie, { format: "photo", platforms: ["instagram"], photoKey: `users/${session.user.id}/uploads/none.jpg` });
    expect(missing.status).toBe(400);
    expect((await generate(cookie, { format: "photo", platforms: [], photoKey })).status).toBe(400);
  });
});

describe("instagram stories", () => {
  it("writes the words for the story and saves them with the advert", async () => {
    const cookie = await readyUser();
    const list = await events(await generate(cookie, { platforms: ["story"] }));
    expect(list.map((e) => e.type)).toEqual(["advert", "image", "done"]);
    const advert = list[0]?.type === "advert" ? list[0].advert : null;
    expect(advert?.storyWords).toEqual(STORY_WORDS);
    const image = list[1]?.type === "image" ? list[1].image : null;
    expect(image).toMatchObject({ platform: "story", label: "Instagram Story", width: 1080, height: 1920 });
    expect(callsTo(GEMINI_URL).at(-1)?.body).toContain('"aspect_ratio":"9:16"');

    const saved: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/posts/${advert?.id ?? ""}`)).json();
    expect(saved.advert.storyWords).toEqual(STORY_WORDS);
  });

  it("writes no story words when no story is ticked", async () => {
    const cookie = await readyUser();
    const list = await events(await generate(cookie, { platforms: ["instagram"] }));
    const advert = list[0]?.type === "advert" ? list[0].advert : null;
    expect(advert?.storyWords).toBeNull();
  });
});

describe("carousels", () => {
  async function makeCarousel(cookie: string): Promise<{ list: GenerationEvent[]; advert: AdvertJson }> {
    const list = await events(await generate(cookie, { format: "carousel" }));
    const first = list[0];
    if (first?.type !== "advert") throw new Error("no advert");
    return { list, advert: first.advert };
  }

  it("writes the caption and five slides, then one background counted as one image", async () => {
    const cookie = await readyUser();
    const { list, advert } = await makeCarousel(cookie);
    expect(list.map((e) => e.type)).toEqual(["advert", "background", "done"]);
    expect(advert).toMatchObject({ format: "carousel", slides: SLIDES, images: [], background: null });
    expect(advert.body).toContain("oven clean");
    const background = list[1]?.type === "background" ? list[1].background : null;
    expect(background?.downloadUrl).toMatch(/kabooly-background-\d{4}-\d{2}-\d{2}\.jpg$/);
    expect(list.at(-1)).toMatchObject({ usage: { imagesToday: { used: 1 } } });
    const body = callsTo(GEMINI_URL).at(-1)?.body ?? "";
    expect(body).toContain('"aspect_ratio":"4:5"');

    const saved: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/posts/${advert.id}`)).json();
    expect(saved.advert.background?.url).toBe(background?.url);
    const library: { adverts: AdvertJson[] } = await (await apiFetch(cookie, "/api/posts")).json();
    expect(library.adverts[0]?.slides).toHaveLength(5);
  });

  it("keeps the slides when the background fails, and refunds it", async () => {
    const cookie = await readyUser();
    onFetch(GEMINI_URL, () => new Response("down", { status: 503 }));
    const { list } = await makeCarousel(cookie);
    expect(list.map((e) => e.type)).toEqual(["advert", "background_error", "done"]);
    expect(list.at(-1)).toMatchObject({ usage: { imagesToday: { used: 0 } } });
  });

  it("regenerates the background, replacing the old file", async () => {
    const cookie = await readyUser();
    const { list, advert } = await makeCarousel(cookie);
    const old = list[1]?.type === "background" ? list[1].background : null;
    const res = await apiFetch(cookie, `/api/posts/${advert.id}/background`, { method: "POST" });
    expect(res.status).toBe(200);
    const { background }: { background: FileJson } = await res.json();
    expect(background.url).not.toBe(old?.url);
    expect(await testEnv.FILES.head(keyOf(old ?? { url: "" }))).toBeNull();
    expect((await usage(cookie)).imagesToday.used).toBe(2);
  });

  it("rewrites the slides, and saves edited slides", async () => {
    const cookie = await readyUser();
    const { advert } = await makeCarousel(cookie);
    const rewritten = await apiFetch(cookie, `/api/posts/${advert.id}/slides`, { method: "POST" });
    expect(rewritten.status).toBe(200);
    expect(callsTo(ANTHROPIC_URL).at(-1)?.body).toContain("record_slides");

    const edited = SLIDES.map((slide, i) => ({ ...slide, heading: `Edited ${i}` }));
    const res = await apiFetch(cookie, `/api/posts/${advert.id}`, { method: "PATCH", body: { slides: edited } });
    expect(await res.json()).toMatchObject({ advert: { slides: edited } });
    const short = await apiFetch(cookie, `/api/posts/${advert.id}`, { method: "PATCH", body: { slides: edited.slice(1) } });
    expect(short.status).toBe(400);
    expect((await apiFetch(cookie, `/api/posts/${advert.id}`, { method: "PATCH", body: {} })).status).toBe(400);
  });

  it("refuses carousel actions on other adverts, and for missing ones", async () => {
    const cookie = await readyUser();
    const list = await events(await generate(cookie, { platforms: [] }));
    const advert = list[0]?.type === "advert" ? list[0].advert : null;
    const id = advert?.id ?? "";
    for (const path of ["background", "slides"]) {
      const res = await apiFetch(cookie, `/api/posts/${id}/${path}`, { method: "POST" });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "not_carousel" });
      expect((await apiFetch(cookie, `/api/posts/nope/${path}`, { method: "POST" })).status).toBe(404);
    }
    const patch = await apiFetch(cookie, `/api/posts/${id}`, { method: "PATCH", body: { slides: SLIDES } });
    expect(patch.status).toBe(400);
  });

  it("needs the business profile to regenerate carousel parts", async () => {
    const cookie = await readyUser();
    const { advert } = await makeCarousel(cookie);
    await testEnv.DB.prepare("DELETE FROM business_profiles WHERE user_id = (SELECT user_id FROM adverts WHERE id = ?1)")
      .bind(advert.id)
      .run();
    expect((await apiFetch(cookie, `/api/posts/${advert.id}/background`, { method: "POST" })).status).toBe(409);
    expect((await apiFetch(cookie, `/api/posts/${advert.id}/slides`, { method: "POST" })).status).toBe(409);
  });

  it("deletes the background with the advert", async () => {
    const cookie = await readyUser();
    const { list, advert } = await makeCarousel(cookie);
    const background = list[1]?.type === "background" ? list[1].background : null;
    await apiFetch(cookie, `/api/posts/${advert.id}`, { method: "DELETE" });
    expect(await testEnv.FILES.head(keyOf(background ?? { url: "" }))).toBeNull();
  });

  it("sends no logo to Gemini for the background", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    onFetch(GEMINI_URL, () => Response.json(geminiImage()));
    await makeCarousel(cookie);
    expect(callsTo(GEMINI_URL).at(-1)?.body).not.toContain("image/png");
  });
});
