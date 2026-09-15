import { advertJson, createAdvert, loadLogo, makePlatformImage } from "./advert-store";
import type { AdvertJson, ImageJson } from "./advert-store";
import { writeAdvert } from "./copywriter";
import type { Platform } from "./db/schema";
import type { Env } from "./env";
import type { Lease, UsageJson } from "./limits";
import { usageFor, usageJson } from "./limits";
import type { Profile } from "./profile";

// One line of the newline-delimited JSON stream a generation answers with.
export type GenerationEvent =
  | { type: "advert"; advert: AdvertJson }
  | { type: "image"; advertId: string; image: ImageJson }
  | { type: "image_error"; advertId: string; platform: Platform; error: string }
  | { type: "error"; error: string }
  | { type: "done"; usage: UsageJson };

export interface GenerationRequest {
  userId: string;
  profile: Profile;
  topic: string;
  platforms: Platform[];
}

type Send = (event: GenerationEvent) => Promise<void>;

async function makeImages(
  env: Env,
  req: GenerationRequest,
  advert: Awaited<ReturnType<typeof createAdvert>>,
  send: Send
): Promise<number> {
  const logo = await loadLogo(env, req.profile);
  const job = { userId: req.userId, advert, profile: req.profile, logo };
  const results = await Promise.all(
    req.platforms.map(async (platform) => {
      try {
        const image = await makePlatformImage(env, job, platform);
        await send({ type: "image", advertId: advert.id, image });
        return true;
      } catch (err) {
        console.error(`image generation failed for ${platform}`, err);
        await send({
          type: "image_error",
          advertId: advert.id,
          platform,
          error: "This image could not be made. Try regenerating it.",
        });
        return false;
      }
    })
  );
  return results.filter(Boolean).length;
}

// Text first (it is quick and the advert is saved as soon as it exists),
// then every ticked platform's image in parallel, each reported as it lands.
// The lease is always finished so the in-flight lock is released and failed
// images are refunded.
export async function runGeneration(
  env: Env,
  req: GenerationRequest,
  lease: Lease,
  send: Send
): Promise<void> {
  let made = 0;
  try {
    const body = await writeAdvert(env, req.profile, req.topic);
    const advert = await createAdvert(env, req.userId, req.topic, body);
    await send({ type: "advert", advert: advertJson(advert, []) });
    if (req.platforms.length) made = await makeImages(env, req, advert, send);
  } catch (err) {
    console.error("generation failed", err);
    await send({ type: "error", error: "The advert could not be written. Try again." });
  } finally {
    await lease.finish(made);
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
