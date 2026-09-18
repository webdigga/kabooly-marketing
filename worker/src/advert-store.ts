import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AdvertFormat, Platform, Slide, StoryWords } from "./db/schema";
import type { Env } from "./env";
import { fileUrl, userPrefix } from "./files";
import {
  brandGenerated,
  brandPhoto,
  carouselBackgroundPrompt,
  fitToShape,
  generateImage,
  imagePrompt,
} from "./image-maker";
import { CAROUSEL_SHAPE, PLATFORM_SPECS } from "./platforms";
import type { Profile } from "./profile";
import { videoJson } from "./video-store";
import type { VideoJson, VideoRow } from "./video-store";

export type AdvertRow = typeof schema.adverts.$inferSelect;
type ImageRow = typeof schema.advertImages.$inferSelect;

export interface FileJson {
  url: string;
  downloadUrl: string;
}

export interface ImageJson extends FileJson {
  platform: Platform;
  label: string;
  width: number;
  height: number;
}

export interface AdvertJson {
  id: string;
  format: AdvertFormat;
  topic: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  images: ImageJson[];
  // Carousels only.
  slides: Slide[] | null;
  // Stories only: the words the browser lays over the image.
  storyWords: StoryWords | null;
  background: FileJson | null;
  video: VideoJson | null;
}

const PLATFORM_ORDER: Platform[] = ["instagram", "facebook", "nextdoor"];

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

// Every file an advert owns lives under this prefix, so deleting an advert
// is one listing. "posts", not "adverts": ad blockers block URLs containing
// the latter.
export function advertPrefix(userId: string, advertId: string): string {
  return `${userPrefix(userId)}posts/${advertId}/`;
}

export function fileJson(key: string, name: string, date: Date): FileJson {
  const url = fileUrl(key);
  const extension = key.slice(key.lastIndexOf(".") + 1);
  return { url, downloadUrl: `${url}?download=kabooly-${name}-${date.toISOString().slice(0, 10)}.${extension}` };
}

export function imageJson(row: ImageRow): ImageJson {
  const spec = PLATFORM_SPECS[row.platform];
  return {
    platform: row.platform,
    label: spec.label,
    width: spec.width,
    height: spec.height,
    ...fileJson(row.r2Key, row.platform, row.generatedAt),
  };
}

export function advertJson(row: AdvertRow, images: ImageRow[], video: VideoRow | null = null): AdvertJson {
  const sorted = [...images].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform)
  );
  return {
    id: row.id,
    format: row.format,
    topic: row.topic,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    images: sorted.map(imageJson),
    slides: row.slides,
    storyWords: row.storyWords,
    background: row.backgroundKey ? fileJson(row.backgroundKey, "background", row.updatedAt) : null,
    video: video ? videoJson(video) : null,
  };
}

export async function createAdvert(
  env: Env,
  userId: string,
  fields: { topic: string; body: string; format: AdvertFormat; slides?: Slide[]; storyWords?: StoryWords }
): Promise<AdvertRow> {
  const now = new Date();
  const row: AdvertRow = {
    id: crypto.randomUUID(),
    userId,
    topic: fields.topic,
    body: fields.body,
    format: fields.format,
    slides: fields.slides ?? null,
    storyWords: fields.storyWords ?? null,
    backgroundKey: null,
    createdAt: now,
    updatedAt: now,
  };
  await db(env).insert(schema.adverts).values(row);
  return row;
}

export async function findAdvert(env: Env, userId: string, id: string): Promise<AdvertRow | null> {
  const [row] = await db(env)
    .select()
    .from(schema.adverts)
    .where(and(eq(schema.adverts.id, id), eq(schema.adverts.userId, userId)));
  return row ?? null;
}

export async function imagesFor(env: Env, advertIds: string[]): Promise<ImageRow[]> {
  if (!advertIds.length) return [];
  return db(env)
    .select()
    .from(schema.advertImages)
    .where(inArray(schema.advertImages.advertId, advertIds));
}

export async function videosFor(env: Env, advertIds: string[]): Promise<VideoRow[]> {
  if (!advertIds.length) return [];
  return db(env)
    .select()
    .from(schema.advertVideos)
    .where(inArray(schema.advertVideos.advertId, advertIds));
}

// The full JSON for one advert: its images and its video, if any.
export async function loadAdvertJson(env: Env, advert: AdvertRow): Promise<AdvertJson> {
  const [images, [video]] = await Promise.all([imagesFor(env, [advert.id]), videosFor(env, [advert.id])]);
  return advertJson(advert, images, video ?? null);
}

export async function updateAdvert(
  env: Env,
  advert: AdvertRow,
  changes: { body?: string; slides?: Slide[]; storyWords?: StoryWords; backgroundKey?: string }
): Promise<AdvertRow> {
  const set = { ...changes, updatedAt: new Date() };
  await db(env).update(schema.adverts).set(set).where(eq(schema.adverts.id, advert.id));
  return { ...advert, ...set };
}

// Removes an advert, its image and video rows (by cascade) and every file
// under its prefix.
export async function deleteAdvert(env: Env, advert: AdvertRow): Promise<void> {
  await db(env).delete(schema.adverts).where(eq(schema.adverts.id, advert.id));
  const listed = await env.FILES.list({ prefix: advertPrefix(advert.userId, advert.id) });
  const keys = listed.objects.map((o) => o.key);
  if (keys.length) await env.FILES.delete(keys);
}

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: AdvertRow): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

export function decodeCursor(value: string | undefined): Cursor | null {
  const match = /^(\d{1,15})_([\w-]{1,64})$/.exec(value ?? "");
  if (!match) return null;
  return { createdAt: new Date(Number(match[1])), id: String(match[2]) };
}

// Newest first. Ties on created_at (seconds) are broken by id.
export async function listAdverts(
  env: Env,
  userId: string,
  cursor: Cursor | null,
  limit: number
): Promise<AdvertRow[]> {
  const t = schema.adverts;
  const before = cursor
    ? or(lt(t.createdAt, cursor.createdAt), and(eq(t.createdAt, cursor.createdAt), lt(t.id, cursor.id)))
    : undefined;
  return db(env)
    .select()
    .from(t)
    .where(and(eq(t.userId, userId), before))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(limit);
}

export type Strips = Partial<Record<Platform, Uint8Array>>;

// The brand strips stamped onto images, one per platform, as far as their
// files are still there.
export async function loadStrips(env: Env, profile: Profile): Promise<Strips> {
  const entries = await Promise.all(
    Object.entries(profile.brandStrips ?? {}).map(async ([platform, key]) => {
      const object = await env.FILES.get(key);
      return object ? ([platform, new Uint8Array(await object.arrayBuffer())] as const) : null;
    })
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}

export interface ImageJob {
  userId: string;
  advert: AdvertRow;
  profile: Profile;
  // The brand strips stamped along the bottom of each platform's image.
  strips: Strips;
}

// Stores one platform image, replacing any earlier one for the same
// platform (row and R2 object).
async function storePlatformImage(
  env: Env,
  advert: AdvertRow,
  platform: Platform,
  bytes: Uint8Array
): Promise<ImageJson> {
  const key = `${advertPrefix(advert.userId, advert.id)}${platform}-${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });

  const [previous] = await db(env)
    .select()
    .from(schema.advertImages)
    .where(and(eq(schema.advertImages.advertId, advert.id), eq(schema.advertImages.platform, platform)));
  const row = { advertId: advert.id, platform, r2Key: key, generatedAt: new Date() };
  await db(env)
    .insert(schema.advertImages)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.advertImages.advertId, schema.advertImages.platform],
      set: { r2Key: key, generatedAt: row.generatedAt },
    });
  if (previous) await env.FILES.delete(previous.r2Key);
  return imageJson(row);
}

// Generates, crops, brands and stores one platform image.
export async function makePlatformImage(env: Env, job: ImageJob, platform: Platform): Promise<ImageJson> {
  const prompt = imagePrompt(job.profile, job.advert.topic, platform);
  const raw = await generateImage(env, prompt, PLATFORM_SPECS[platform].aspectRatio, null);
  const branded = await brandGenerated(env, raw, platform, job.strips[platform] ?? null);
  return storePlatformImage(env, job.advert, platform, branded);
}

export interface PhotoJob {
  advert: AdvertRow;
  photo: Uint8Array;
  strips: Strips;
}

// Cuts and brands one platform image from the customer's own photo.
export async function makePhotoImage(env: Env, job: PhotoJob, platform: Platform): Promise<ImageJson> {
  const branded = await brandPhoto(env, job.photo, platform, job.strips[platform] ?? null);
  return storePlatformImage(env, job.advert, platform, branded);
}

// Generates the one background every carousel slide is laid over,
// replacing any earlier one.
export async function makeCarouselBackground(
  env: Env,
  advert: AdvertRow,
  profile: Profile
): Promise<AdvertRow> {
  const raw = await generateImage(env, carouselBackgroundPrompt(profile, advert.topic), CAROUSEL_SHAPE.aspectRatio, null);
  const key = `${advertPrefix(advert.userId, advert.id)}background-${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, await fitToShape(env, raw, CAROUSEL_SHAPE), { httpMetadata: { contentType: "image/jpeg" } });
  const updated = await updateAdvert(env, advert, { backgroundKey: key });
  if (advert.backgroundKey) await env.FILES.delete(advert.backgroundKey);
  return updated;
}
