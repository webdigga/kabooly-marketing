import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  advertJson,
  decodeCursor,
  deleteAdvert,
  encodeCursor,
  fileJson,
  findAdvert,
  imagesFor,
  listAdverts,
  loadAdvertJson,
  loadStrips,
  makeCarouselBackground,
  makePlatformImage,
  updateAdvert,
  videosFor,
} from "./advert-store";
import type { AdvertRow } from "./advert-store";
import { suggestTopic, writeAdvert, writeSlides, SLIDE_COUNT } from "./copywriter";
import { PLATFORMS } from "./db/schema";
import type { Platform } from "./db/schema";
import { uploadsPrefix } from "./files";
import { streamGeneration, withRetry } from "./generation";
import { beginGeneration, deniedResponse, isDenied, usageFor, usageJson } from "./limits";
import type { GenerationRequest } from "./limits";
import { loadProfile } from "./profile";
import type { Profile } from "./profile";
import type { AppEnv } from "./session";
import { parseJson } from "./validation";
import { findVideo, refreshVideo, requestVideo, videoJson } from "./video-store";

export const MAX_TOPIC_LENGTH = 200;
export const MAX_MOTION_LENGTH = 300;
const PAGE_SIZE = 12;

// Ad blockers block any URL containing "/adverts/" (and similar words), so
// no route or file path uses them. Saved adverts are "posts" in every URL.
export const advertsApi = new Hono<AppEnv>();

type AppContext = Context<AppEnv>;

async function requireProfile(c: AppContext): Promise<Profile | Response> {
  const profile = await loadProfile(c.env, c.get("userId"));
  return profile ?? c.json({ error: "Complete your business profile first", code: "no_profile" }, 409);
}

function failed(c: AppContext): Response {
  return c.json({ error: "Generation failed. Try again." }, 502);
}

// Runs one limited piece of work: admitted by the account's limiter, and
// always reported back so the lock is released and failures refunded.
async function limited(
  c: AppContext,
  request: GenerationRequest,
  work: () => Promise<{ response: Response; unitsMade: number }>
): Promise<Response> {
  const lease = await beginGeneration(c.env, c.get("userId"), request);
  if (isDenied(lease)) return deniedResponse(c, lease);
  let unitsMade = 0;
  try {
    const result = await work();
    unitsMade = result.unitsMade;
    return result.response;
  } catch (err) {
    console.error(`${request.kind} generation failed`, err);
    return failed(c);
  } finally {
    await lease.finish(unitsMade);
  }
}

const suggestBody = z.object({
  avoid: z.array(z.string().max(MAX_TOPIC_LENGTH)).max(10).default([]),
});

advertsApi.post("/topics/suggest", async (c) => {
  const parsed = await parseJson(c, suggestBody);
  if (!parsed.ok) return parsed.response;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, { kind: "text", units: 0, holdLock: false }, async () => {
    const topic = await suggestTopic(c.env, profile, parsed.data.avoid);
    return { response: c.json({ topic }), unitsMade: 0 };
  });
});

// A page loaded before formats existed sends none; it means generated images.
function defaultFormat(value: unknown): unknown {
  return value && typeof value === "object" && !("format" in value) ? { ...value, format: "images" } : value;
}

const generationBody = z.preprocess(defaultFormat, z.discriminatedUnion("format", [
  z.object({
    format: z.literal("images"),
    topic: z.string().trim().min(1).max(MAX_TOPIC_LENGTH),
    platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length),
  }),
  z.object({
    format: z.literal("photo"),
    topic: z.string().trim().min(1).max(MAX_TOPIC_LENGTH),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(PLATFORMS.length),
    photoKey: z.string().max(300),
  }),
  z.object({
    format: z.literal("carousel"),
    topic: z.string().trim().min(1).max(MAX_TOPIC_LENGTH),
  }),
]));

type GenerationBody = z.infer<typeof generationBody>;

// What a generation counts against: generated images, one carousel
// background, or only text (own-photo posts and image-free adverts).
function limitRequest(body: GenerationBody, platforms: Platform[]): GenerationRequest {
  if (body.format === "carousel") return { kind: "image", units: 1, holdLock: true };
  if (body.format === "images" && platforms.length) return { kind: "image", units: platforms.length, holdLock: true };
  return { kind: "text", units: 0, holdLock: true };
}

// The uploaded photo an own-photo post is cut from, if it belongs to this
// account and is still there.
async function uploadedPhoto(c: AppContext, key: string): Promise<Uint8Array | null> {
  if (!key.startsWith(uploadsPrefix(c.get("userId"))) || key.includes("..")) return null;
  const object = await c.env.FILES.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

advertsApi.post("/generations", async (c) => {
  const parsed = await parseJson(c, generationBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  const userId = c.get("userId");
  const platforms = body.format === "carousel" ? [] : [...new Set(body.platforms)];
  const photo = body.format === "photo" ? await uploadedPhoto(c, body.photoKey) : undefined;
  if (photo === null) {
    return c.json({ error: "Upload your photo again", code: "photo_missing" }, 400);
  }
  const lease = await beginGeneration(c.env, userId, limitRequest(body, platforms));
  if (isDenied(lease)) return deniedResponse(c, lease);
  const request = {
    userId,
    profile,
    topic: body.topic,
    format: body.format,
    platforms,
    photo: photo && body.format === "photo" ? { bytes: photo, key: body.photoKey } : undefined,
  };
  return streamGeneration(c.env, c.executionCtx, request, lease);
});

advertsApi.get("/posts", async (c) => {
  const userId = c.get("userId");
  const rows = await listAdverts(c.env, userId, decodeCursor(c.req.query("before")), PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((r) => r.id);
  const [images, videos] = await Promise.all([imagesFor(c.env, ids), videosFor(c.env, ids)]);
  return c.json({
    adverts: page.map((row) =>
      advertJson(
        row,
        images.filter((i) => i.advertId === row.id),
        videos.find((v) => v.advertId === row.id)
      )
    ),
    // The extra row only proves there is another page; the cursor is the
    // last advert shown.
    nextCursor: rows.length > PAGE_SIZE ? page.slice(-1).map(encodeCursor).join("") : null,
  });
});

async function advertOr404(c: AppContext, id: string): Promise<AdvertRow | Response> {
  const advert = await findAdvert(c.env, c.get("userId"), id);
  return advert ?? c.json({ error: "Not found" }, 404);
}

advertsApi.get("/posts/:id", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  return c.json({ advert: await loadAdvertJson(c.env, advert) });
});

advertsApi.delete("/posts/:id", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  await deleteAdvert(c.env, advert);
  return c.json({ ok: true });
});

// Clearing out the library: one request rather than one per advert. Ids
// that are not this account's are simply not deleted.
export const MAX_BULK_DELETE = 50;

const bulkDeleteBody = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK_DELETE),
});

advertsApi.post("/posts/delete", async (c) => {
  const parsed = await parseJson(c, bulkDeleteBody);
  if (!parsed.ok) return parsed.response;
  let deleted = 0;
  for (const id of new Set(parsed.data.ids)) {
    const advert = await findAdvert(c.env, c.get("userId"), id);
    if (!advert) continue;
    await deleteAdvert(c.env, advert);
    deleted += 1;
  }
  return c.json({ deleted });
});

const slideBody = z.object({
  heading: z.string().trim().min(1).max(80),
  body: z.string().trim().max(240),
});

const editBody = z
  .object({
    body: z.string().trim().min(1).max(5000).optional(),
    slides: z.array(slideBody).length(SLIDE_COUNT).optional(),
  })
  .refine((b) => b.body !== undefined || b.slides !== undefined);

advertsApi.patch("/posts/:id", async (c) => {
  const parsed = await parseJson(c, editBody);
  if (!parsed.ok) return parsed.response;
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  if (parsed.data.slides && advert.format !== "carousel") {
    return c.json({ error: "Only carousels have slides", code: "not_carousel" }, 400);
  }
  const updated = await updateAdvert(c.env, advert, parsed.data);
  return c.json({ advert: await loadAdvertJson(c.env, updated) });
});

advertsApi.post("/posts/:id/text", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, { kind: "text", units: 0, holdLock: true }, async () => {
    const body = await writeAdvert(c.env, profile, advert.topic);
    const updated = await updateAdvert(c.env, advert, { body });
    return { response: c.json({ advert: await loadAdvertJson(c.env, updated) }), unitsMade: 0 };
  });
});

advertsApi.post("/posts/:id/slides", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  if (advert.format !== "carousel") return c.json({ error: "Only carousels have slides", code: "not_carousel" }, 400);
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, { kind: "text", units: 0, holdLock: true }, async () => {
    const slides = await writeSlides(c.env, profile, advert.topic);
    const updated = await updateAdvert(c.env, advert, { slides });
    return { response: c.json({ advert: await loadAdvertJson(c.env, updated) }), unitsMade: 0 };
  });
});

advertsApi.post("/posts/:id/background", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  if (advert.format !== "carousel") return c.json({ error: "Only carousels have a background", code: "not_carousel" }, 400);
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, { kind: "image", units: 1, holdLock: true }, async () => {
    const updated = await makeCarouselBackground(c.env, advert, profile);
    const background = fileJson(String(updated.backgroundKey), "background", updated.updatedAt);
    return { response: c.json({ background }), unitsMade: 1 };
  });
});

function isPlatform(value: string | undefined): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

advertsApi.post("/posts/:id/images/:platform", async (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) return c.json({ error: "Not found" }, 404);
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  // Own-photo images are cut from a photo that is no longer kept, and a
  // carousel has no platform images.
  if (advert.format !== "images") {
    return c.json({ error: "Only generated images can be regenerated", code: "not_generated" }, 400);
  }
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, { kind: "image", units: 1, holdLock: true }, async () => {
    const strips = await loadStrips(c.env, profile);
    const job = { userId: c.get("userId"), advert, profile, strips };
    const image = await withRetry(() => makePlatformImage(c.env, job, platform));
    return { response: c.json({ image }), unitsMade: 1 };
  });
});

const videoBody = z.object({
  // Blank means "let the app describe the movement".
  motion: z
    .string()
    .trim()
    .max(MAX_MOTION_LENGTH)
    .nullish()
    .transform((v) => (v?.length ? v : null)),
});

// Starts a video for an advert (or replaces its last one). The video takes
// minutes: this answers once Google has accepted the job, and the app then
// checks on it with GET.
advertsApi.post("/posts/:id/video", async (c) => {
  const parsed = await parseJson(c, videoBody);
  if (!parsed.ok) return parsed.response;
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  const userId = c.get("userId");
  const existing = await findVideo(c.env, advert.id);
  if (existing && (await refreshVideo(c.env, userId, existing)).status === "pending") {
    return c.json({ error: "This video is still being made.", code: "video_pending" }, 409);
  }
  const lease = await beginGeneration(c.env, userId, { kind: "video", units: 1, holdLock: false });
  if (isDenied(lease)) return deniedResponse(c, lease);
  try {
    const row = await requestVideo(c.env, { advert, profile, motion: parsed.data.motion, lease });
    return c.json({ video: videoJson(row), usage: usageJson(await usageFor(c.env, userId)) }, 202);
  } catch (err) {
    console.error("video could not be started", err);
    await lease.finish(0);
    return failed(c);
  }
});

advertsApi.get("/posts/:id/video", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  const row = await findVideo(c.env, advert.id);
  if (!row) return c.json({ error: "Not found" }, 404);
  const video = await refreshVideo(c.env, c.get("userId"), row);
  return c.json({ video: videoJson(video) });
});

advertsApi.get("/usage", async (c) => {
  return c.json(usageJson(await usageFor(c.env, c.get("userId"))));
});
