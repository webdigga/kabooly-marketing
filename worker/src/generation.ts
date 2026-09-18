import {
  advertJson,
  createAdvert,
  fileJson,
  loadStrips,
  makeCarouselBackground,
  makePhotoImage,
  makePlatformImage,
} from "./advert-store";
import type { AdvertJson, AdvertRow, FileJson, ImageJson } from "./advert-store";
import { writeAdvert, writeSlides, writeStoryWords } from "./copywriter";
import type { AdvertFormat, Platform } from "./db/schema";
import type { Env } from "./env";
import type { Lease, UsageJson } from "./limits";
import { usageFor, usageJson } from "./limits";
import type { Profile } from "./profile";

// One line of the newline-delimited JSON stream a generation answers with.
export type GenerationEvent =
  | { type: "advert"; advert: AdvertJson }
  | { type: "image"; advertId: string; image: ImageJson }
  | { type: "image_error"; advertId: string; platform: Platform; error: string }
  | { type: "background"; advertId: string; background: FileJson }
  | { type: "background_error"; advertId: string; error: string }
  | { type: "error"; error: string }
  | { type: "done"; usage: UsageJson };

export interface GenerationRequest {
  userId: string;
  profile: Profile;
  topic: string;
  format: AdvertFormat;
  platforms: Platform[];
  // Own-photo posts only: the uploaded photo, deleted once its platform
  // images are cut.
  photo?: { bytes: Uint8Array; key: string };
}

type Send = (event: GenerationEvent) => Promise<void>;

type ImageMaker = (platform: Platform) => Promise<ImageJson>;

async function imageMaker(env: Env, req: GenerationRequest, advert: AdvertRow): Promise<ImageMaker> {
  const strips = await loadStrips(env, req.profile);
  if (req.photo) {
    const job = { advert, photo: req.photo.bytes, strips };
    return (platform) => makePhotoImage(env, job, platform);
  }
  const job = { userId: req.userId, advert, profile: req.profile, strips };
  return (platform) => makePlatformImage(env, job, platform);
}

// One attempt, then one retry: a single image failing is usually Gemini
// being busy, and a second try costs nothing when the first made nothing.
export async function withRetry(make: () => Promise<ImageJson>): Promise<ImageJson> {
  try {
    return await make();
  } catch (err) {
    console.error("image generation failed, trying once more", err);
    return make();
  }
}

// The ticked platforms one at a time, each reported as it lands. One at a
// time, not all at once: three together run into Gemini's limits.
async function makeImages(env: Env, req: GenerationRequest, advert: AdvertRow, send: Send): Promise<number> {
  const make = await imageMaker(env, req, advert);
  let made = 0;
  for (const platform of req.platforms) {
    try {
      const image = await withRetry(() => make(platform));
      made += 1;
      await send({ type: "image", advertId: advert.id, image });
    } catch (err) {
      console.error(`image generation failed for ${platform}`, err);
      await send({
        type: "image_error",
        advertId: advert.id,
        platform,
        // An own-photo image cannot be regenerated: the photo is not kept.
        error: req.photo
          ? "This image could not be made from your photo. Try again."
          : "This image could not be made. Try regenerating it.",
      });
    }
  }
  return made;
}

async function makeBackground(env: Env, req: GenerationRequest, advert: AdvertRow, send: Send): Promise<number> {
  try {
    const updated = await makeCarouselBackground(env, advert, req.profile);
    const background = fileJson(String(updated.backgroundKey), "background", updated.updatedAt);
    await send({ type: "background", advertId: advert.id, background });
    return 1;
  } catch (err) {
    console.error("carousel background failed", err);
    await send({
      type: "background_error",
      advertId: advert.id,
      error: "The background could not be made. Try regenerating it.",
    });
    return 0;
  }
}

async function writeCopy(env: Env, req: GenerationRequest): Promise<AdvertRow> {
  // A Story carries no caption, so its words go on the image itself.
  const [body, slides, storyWords] = await Promise.all([
    writeAdvert(env, req.profile, req.topic),
    req.format === "carousel" ? writeSlides(env, req.profile, req.topic) : undefined,
    req.platforms.includes("story") ? writeStoryWords(env, req.profile, req.topic) : undefined,
  ]);
  return createAdvert(env, req.userId, { topic: req.topic, body, format: req.format, slides, storyWords });
}

// Words first (quick, and the advert is saved as soon as it exists), then
// the pictures: platform images, or a carousel's background. The lease is
// always finished so the in-flight lock is released and failed images are
// refunded.
export async function runGeneration(env: Env, req: GenerationRequest, lease: Lease, send: Send): Promise<void> {
  let made = 0;
  try {
    const advert = await writeCopy(env, req);
    await send({ type: "advert", advert: advertJson(advert, []) });
    if (req.format === "carousel") made = await makeBackground(env, req, advert, send);
    else if (req.platforms.length) made = await makeImages(env, req, advert, send);
  } catch (err) {
    console.error("generation failed", err);
    await send({ type: "error", error: "The advert could not be written. Try again." });
  } finally {
    await lease.finish(made);
    if (req.photo) await env.FILES.delete(req.photo.key);
  }
  await send({ type: "done", usage: usageJson(await usageFor(env, req.userId)) });
}

// Streams events to the client. The job itself runs under waitUntil, so a
// closed tab does not stop an advert from being finished and saved.
export function streamGeneration(
  env: Env,
  ctx: { waitUntil: (promise: Promise<unknown>) => void },
  req: GenerationRequest,
  lease: Lease
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send: Send = async (event) => {
    try {
      await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    } catch {
      // The client went away; keep working so the advert is still saved.
    }
  };
  const job = runGeneration(env, req, lease, send).finally(async () => {
    try {
      await writer.close();
    } catch {
      // Already closed by a disconnected client.
    }
  });
  ctx.waitUntil(job);
  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
