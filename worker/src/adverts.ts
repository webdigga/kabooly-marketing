import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  advertJson,
  decodeCursor,
  encodeCursor,
  findAdvert,
  imagesFor,
  listAdverts,
  loadLogo,
  makePlatformImage,
  updateAdvertBody,
} from "./advert-store";
import { suggestTopic, writeAdvert } from "./copywriter";
import { PLATFORMS } from "./db/schema";
import type { Platform } from "./db/schema";
import { streamGeneration } from "./generation";
import type { GenerationKind } from "./limiter";
import { beginGeneration, deniedResponse, isDenied, usageFor, usageJson } from "./limits";
import { loadProfile } from "./profile";
import type { Profile } from "./profile";
import type { AppEnv } from "./session";
import { parseJson } from "./validation";

export const MAX_TOPIC_LENGTH = 200;
const PAGE_SIZE = 12;

// Ad blockers block any URL containing "/adverts/" (and similar words), so
// no route or file path uses them. Saved adverts are "posts" in every URL.
export const advertsApi = new Hono<AppEnv>();

type AppContext = Context<AppEnv>;

async function requireProfile(c: AppContext): Promise<Profile | Response> {
  const profile = await loadProfile(c.env, c.get("userId"));
  return profile ?? c.json({ error: "Complete your business profile first", code: "no_profile" }, 409);
}

// Runs one limited piece of work: admitted by the account's limiter, and
// always reported back so the lock is released and failures refunded.
async function limited(
  c: AppContext,
  kind: GenerationKind,
  images: number,
  work: () => Promise<{ response: Response; imagesMade: number }>
): Promise<Response> {
  const lease = await beginGeneration(c.env, c.get("userId"), kind, images);
  if (isDenied(lease)) return deniedResponse(c, lease);
  let imagesMade = 0;
  try {
    const result = await work();
    imagesMade = result.imagesMade;
    return result.response;
  } catch (err) {
    console.error(`${kind} generation failed`, err);
    return c.json({ error: "Generation failed. Try again." }, 502);
  } finally {
    await lease.finish(imagesMade);
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
  return limited(c, "text", 0, async () => {
    const topic = await suggestTopic(c.env, profile, parsed.data.avoid);
    return { response: c.json({ topic }), imagesMade: 0 };
  });
});

const generationBody = z.object({
  topic: z.string().trim().min(1).max(MAX_TOPIC_LENGTH),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length),
});

advertsApi.post("/generations", async (c) => {
  const parsed = await parseJson(c, generationBody);
  if (!parsed.ok) return parsed.response;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  const platforms = [...new Set(parsed.data.platforms)];
  const kind = platforms.length ? "image" : "text";
  const userId = c.get("userId");
  const lease = await beginGeneration(c.env, userId, kind, platforms.length);
  if (isDenied(lease)) return deniedResponse(c, lease);
  return streamGeneration(
    c.env,
    c.executionCtx,
    { userId, profile, topic: parsed.data.topic, platforms },
    lease
  );
});

advertsApi.get("/posts", async (c) => {
  const userId = c.get("userId");
  const rows = await listAdverts(c.env, userId, decodeCursor(c.req.query("before")), PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const images = await imagesFor(c.env, page.map((r) => r.id));
  return c.json({
    adverts: page.map((row) => advertJson(row, images.filter((i) => i.advertId === row.id))),
    // The extra row only proves there is another page; the cursor is the
    // last advert shown.
    nextCursor: rows.length > PAGE_SIZE ? page.slice(-1).map(encodeCursor).join("") : null,
  });
});

async function advertOr404(c: AppContext, id: string) {
  const advert = await findAdvert(c.env, c.get("userId"), id);
  return advert ?? c.json({ error: "Not found" }, 404);
}

advertsApi.get("/posts/:id", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  return c.json({ advert: advertJson(advert, await imagesFor(c.env, [advert.id])) });
});

const editBody = z.object({ body: z.string().trim().min(1).max(5000) });

advertsApi.patch("/posts/:id", async (c) => {
  const parsed = await parseJson(c, editBody);
  if (!parsed.ok) return parsed.response;
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  const updated = await updateAdvertBody(c.env, advert, parsed.data.body);
  return c.json({ advert: advertJson(updated, await imagesFor(c.env, [advert.id])) });
});

advertsApi.post("/posts/:id/text", async (c) => {
  const advert = await advertOr404(c, c.req.param("id"));
  if (advert instanceof Response) return advert;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, "text", 0, async () => {
    const body = await writeAdvert(c.env, profile, advert.topic);
    const updated = await updateAdvertBody(c.env, advert, body);
    const images = await imagesFor(c.env, [advert.id]);
    return { response: c.json({ advert: advertJson(updated, images) }), imagesMade: 0 };
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
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  return limited(c, "image", 1, async () => {
    const logo = await loadLogo(c.env, profile);
    const job = { userId: c.get("userId"), advert, profile, logo };
    const image = await makePlatformImage(c.env, job, platform);
    return { response: c.json({ image }), imagesMade: 1 };
  });
});

advertsApi.get("/usage", async (c) => {
  return c.json(usageJson(await usageFor(c.env, c.get("userId"))));
});
