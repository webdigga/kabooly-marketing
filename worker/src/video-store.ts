import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { advertPrefix, fileJson } from "./advert-store";
import type { AdvertRow, FileJson } from "./advert-store";
import { planVideo } from "./copywriter";
import * as schema from "./db/schema";
import type { VideoStatus } from "./db/schema";
import type { Env } from "./env";
import { fitToShape, generateImage, videoStartPrompt } from "./image-maker";
import { leaseFor } from "./limits";
import type { Lease } from "./limits";
import { VIDEO_SHAPE } from "./platforms";
import type { Profile } from "./profile";
import { checkVideo, deleteVideoJob, startVideo, VIDEO_JOB_TTL_MS, videoPrompt } from "./video-maker";

export type VideoRow = typeof schema.advertVideos.$inferSelect;

export interface VideoJson {
  status: VideoStatus;
  motion: string | null;
  // The starting image, shown while the video is being made.
  start: FileJson;
  // Only once the video is ready.
  video: FileJson | null;
}

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export function videoJson(row: VideoRow): VideoJson {
  return {
    status: row.status,
    motion: row.motion,
    start: fileJson(row.startKey, "video-start", row.createdAt),
    video: row.r2Key ? fileJson(row.r2Key, "video", row.updatedAt) : null,
  };
}

export async function findVideo(env: Env, advertId: string): Promise<VideoRow | null> {
  const [row] = await db(env).select().from(schema.advertVideos).where(eq(schema.advertVideos.advertId, advertId));
  return row ?? null;
}

async function put(env: Env, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await env.FILES.put(key, bytes, { httpMetadata: { contentType } });
}

export interface VideoRequest {
  advert: AdvertRow;
  profile: Profile;
  motion: string | null;
  lease: Lease;
}

// Plans the shots and captions, makes the vertical starting image of the
// first shot, starts the video
// from it in Google's background mode, and records the job as pending,
// replacing any earlier video for the advert. Throws if any step fails; the
// caller refunds the lease.
export async function requestVideo(env: Env, req: VideoRequest): Promise<VideoRow> {
  const { advert, profile } = req;
  const plan = await planVideo(env, profile, advert.topic, req.motion);
  const startPrompt = videoStartPrompt(profile, advert.topic, plan.hook.scene);
  const raw = await generateImage(env, startPrompt, VIDEO_SHAPE.aspectRatio, null);
  const start = await fitToShape(env, raw, VIDEO_SHAPE);
  const interactionId = await startVideo(env, start, videoPrompt(profile, plan));

  const startKey = `${advertPrefix(advert.userId, advert.id)}video-start-${crypto.randomUUID()}.jpg`;
  await put(env, startKey, start, "image/jpeg");
  const previous = await findVideo(env, advert.id);
  const now = new Date();
  const row: VideoRow = {
    advertId: advert.id,
    status: "pending",
    leaseId: req.lease.id,
    interactionId,
    startKey,
    r2Key: null,
    motion: req.motion,
    createdAt: now,
    updatedAt: now,
  };
  const { advertId: _advertId, ...changes } = row;
  await db(env)
    .insert(schema.advertVideos)
    .values(row)
    .onConflictDoUpdate({ target: schema.advertVideos.advertId, set: changes });
  const stale = [previous?.startKey, previous?.r2Key].filter((k): k is string => Boolean(k));
  if (stale.length) await env.FILES.delete(stale);
  return row;
}

// Writes the outcome only if the row is still the pending job it was when
// read, so two checks racing each other settle it once.
async function settle(env: Env, row: VideoRow, changes: Partial<VideoRow>): Promise<boolean> {
  const result = await db(env)
    .update(schema.advertVideos)
    .set({ ...changes, updatedAt: new Date() })
    .where(
      and(
        eq(schema.advertVideos.advertId, row.advertId),
        eq(schema.advertVideos.leaseId, row.leaseId),
        eq(schema.advertVideos.status, "pending")
      )
    );
  return result.meta.changes > 0;
}

async function fail(env: Env, userId: string, row: VideoRow, reason: string): Promise<VideoRow> {
  console.error(`video for ${row.advertId} failed: ${reason}`);
  if (await settle(env, row, { status: "failed" })) {
    await leaseFor(env, userId, row.leaseId).finish(0);
  }
  return (await findVideo(env, row.advertId)) ?? row;
}

// Checks on a pending video and settles it: saves the finished video, or
// marks it failed and refunds it. A check that cannot reach Google leaves
// it pending for the next one, until the job has run too long.
export async function refreshVideo(env: Env, userId: string, row: VideoRow, now = Date.now()): Promise<VideoRow> {
  if (row.status !== "pending") return row;
  if (now - row.createdAt.getTime() > VIDEO_JOB_TTL_MS) return fail(env, userId, row, "timed out");
  // Rows are only written pending with a job id.
  const interactionId = String(row.interactionId);
  let job: Awaited<ReturnType<typeof checkVideo>>;
  try {
    job = await checkVideo(env, interactionId);
  } catch (err) {
    console.error("video check failed", err);
    return row;
  }
  if (job.state === "running") return row;
  if (job.state === "failed") return fail(env, userId, row, job.reason);

  const key = `${advertPrefix(userId, row.advertId)}video-${crypto.randomUUID()}.mp4`;
  await put(env, key, job.bytes, "video/mp4");
  if (!(await settle(env, row, { status: "ready", r2Key: key }))) {
    await env.FILES.delete(key);
  } else {
    await deleteVideoJob(env, interactionId);
  }
  return (await findVideo(env, row.advertId)) ?? row;
}
