import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Platform } from "./db/schema";
import type { Env } from "./env";
import { fileUrl, userPrefix } from "./files";
import { bytesToBase64, fitToPlatform, generateImage, imagePrompt } from "./image-maker";
import type { Logo } from "./image-maker";
import { PLATFORM_SPECS } from "./platforms";
import type { Profile } from "./profile";

type AdvertRow = typeof schema.adverts.$inferSelect;
type ImageRow = typeof schema.advertImages.$inferSelect;

export interface ImageJson {
  platform: Platform;
  label: string;
  width: number;
  height: number;
  url: string;
  downloadUrl: string;
}

export interface AdvertJson {
  id: string;
  topic: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  images: ImageJson[];
}

const PLATFORM_ORDER: Platform[] = ["instagram", "facebook", "nextdoor"];

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export function imageJson(row: ImageRow): ImageJson {
  const spec = PLATFORM_SPECS[row.platform];
  const date = row.generatedAt.toISOString().slice(0, 10);
  const url = fileUrl(row.r2Key);
  return {
    platform: row.platform,
    label: spec.label,
    width: spec.width,
    height: spec.height,
    url,
    downloadUrl: `${url}?download=kabooly-${row.platform}-${date}.jpg`,
  };
}

export function advertJson(row: AdvertRow, images: ImageRow[]): AdvertJson {
  const sorted = [...images].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform)
  );
  return {
    id: row.id,
    topic: row.topic,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    images: sorted.map(imageJson),
  };
}

export async function createAdvert(
  env: Env,
  userId: string,
  topic: string,
  body: string
): Promise<AdvertRow> {
  const now = new Date();
  const row = { id: crypto.randomUUID(), userId, topic, body, createdAt: now, updatedAt: now };
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

export async function updateAdvertBody(env: Env, advert: AdvertRow, body: string): Promise<AdvertRow> {
  const updated = { ...advert, body, updatedAt: new Date() };
  await db(env)
    .update(schema.adverts)
    .set({ body, updatedAt: updated.updatedAt })
    .where(eq(schema.adverts.id, advert.id));
  return updated;
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

export async function loadLogo(env: Env, profile: Profile): Promise<Logo | null> {
  if (!profile.logoKey) return null;
  const object = await env.FILES.get(profile.logoKey);
  if (!object) return null;
  return {
    mimeType: object.httpMetadata?.contentType ?? "image/png",
    base64: bytesToBase64(new Uint8Array(await object.arrayBuffer())),
  };
}

export interface ImageJob {
  userId: string;
  advert: AdvertRow;
  profile: Profile;
  logo: Logo | null;
}

// Generates, crops and stores one platform image, replacing any earlier
// one for the same platform (row and R2 object).
export async function makePlatformImage(env: Env, job: ImageJob, platform: Platform): Promise<ImageJson> {
  const prompt = imagePrompt(job.profile, job.advert.topic, platform, job.logo !== null);
  const raw = await generateImage(env, prompt, platform, job.logo);
  const fitted = await fitToPlatform(env, raw, platform);
  const key = `${userPrefix(job.userId)}adverts/${job.advert.id}/${platform}-${crypto.randomUUID()}.jpg`;
  await env.FILES.put(key, fitted, { httpMetadata: { contentType: "image/jpeg" } });

  const [previous] = await db(env)
    .select()
    .from(schema.advertImages)
    .where(and(eq(schema.advertImages.advertId, job.advert.id), eq(schema.advertImages.platform, platform)));
  const row = { advertId: job.advert.id, platform, r2Key: key, generatedAt: new Date() };
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
