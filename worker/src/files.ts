import { Hono } from "hono";
import type { Env } from "./env";
import { streamOf } from "./image-maker";
import type { AppEnv } from "./session";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_STRIP_BYTES = 1024 * 1024;
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
// The largest platform image is 1200 pixels wide or tall.
export const MIN_PHOTO_SIDE = 1200;

export type RasterType = "image/png" | "image/jpeg" | "image/webp";

const EXTENSIONS: Record<RasterType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Every object lives under its owner's prefix, which is what the file route
// checks before serving anything.
export function userPrefix(userId: string): string {
  return `users/${userId}/`;
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

// Trusts the bytes, not the declared type: PNG, JPEG and WebP signatures.
export function sniffRaster(bytes: Uint8Array): RasterType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) {
    return "image/png";
  }
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  const riff = String.fromCharCode(b(0), b(1), b(2), b(3));
  const webp = String.fromCharCode(b(8), b(9), b(10), b(11));
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

// A logo in a format nothing downstream reads (AVIF and the like), turned
// into a PNG. Null when Cloudflare Images cannot decode it either.
async function toPng(env: Env, bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const result = await env.IMAGES.input(streamOf(bytes)).output({ format: "image/png" });
    return new Uint8Array(await result.response().arrayBuffer());
  } catch {
    return null;
  }
}

export async function storeLogo(
  env: Env,
  userId: string,
  input: Uint8Array
): Promise<{ key: string; url: string } | null> {
  // A website may serve its logo in a format nothing downstream reads,
  // which is worth converting rather than passing over for a worse logo
  // further down the page.
  const sniffed = sniffRaster(input);
  const png = sniffed ? null : await toPng(env, input);
  if (!sniffed && !png) return null;
  const type: RasterType = sniffed ?? "image/png";
  const bytes = png ?? input;
  const key = `${userPrefix(userId)}logos/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key, url: fileUrl(key) };
}

// A customer's own photo waiting to become a post. Only the latest upload
// is kept: uploading another replaces it, and generating a post from it
// deletes it once the platform images are cut.
// The brand strip the browser draws when the profile is saved.
export function brandPrefix(userId: string): string {
  return `${userPrefix(userId)}brand/`;
}

export function uploadsPrefix(userId: string): string {
  return `${userPrefix(userId)}uploads/`;
}

export type PhotoResult =
  | { ok: true; key: string; url: string; width: number; height: number }
  | { ok: false; status: 413 | 415 | 422; error: string; code: string };

export async function storePhoto(env: Env, userId: string, bytes: Uint8Array): Promise<PhotoResult> {
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, status: 413, error: "Photos must be 20 MB or smaller", code: "photo_too_large" };
  }
  const type = sniffRaster(bytes);
  if (!type) return { ok: false, status: 415, error: "Upload a JPEG, PNG or WebP photo", code: "photo_type" };
  const size = await photoSize(env, bytes);
  if (!size) return { ok: false, status: 415, error: "That photo could not be read", code: "photo_type" };
  const { width, height } = size;
  if (Math.min(width, height) < MIN_PHOTO_SIDE) {
    return {
      ok: false,
      status: 422,
      error: `Photos must be at least ${MIN_PHOTO_SIDE} pixels on the shortest side`,
      code: "photo_too_small",
    };
  }
  const listed = await env.FILES.list({ prefix: uploadsPrefix(userId) });
  if (listed.objects.length) await env.FILES.delete(listed.objects.map((o) => o.key));
  const key = `${uploadsPrefix(userId)}${crypto.randomUUID()}.${EXTENSIONS[type]}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  return { ok: true, key, url: fileUrl(key), width, height };
}

// Null when the bytes carry an image signature but cannot be read. Only
// raster types reach here, and every raster info has a size.
async function photoSize(env: Env, bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  try {
    const info = await env.IMAGES.info(streamOf(bytes));
    return info as { width: number; height: number };
  } catch {
    return null;
  }
}

export const filesApi = new Hono<AppEnv>();

filesApi.post("/uploads/brand-strip", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_STRIP_BYTES) {
    return c.json({ error: "That image is too large" }, 413);
  }
  if (sniffRaster(bytes) !== "image/png") {
    return c.json({ error: "The brand strip must be a PNG" }, 415);
  }
  const key = `${brandPrefix(c.get("userId"))}${crypto.randomUUID()}.png`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  return c.json({ key, url: fileUrl(key) });
});

filesApi.post("/uploads/photo", async (c) => {
  const result = await storePhoto(c.env, c.get("userId"), new Uint8Array(await c.req.arrayBuffer()));
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status);
  const { ok: _ok, ...photo } = result;
  return c.json(photo);
});

filesApi.post("/uploads/logo", async (c) => {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return c.json({ error: "Logos must be 2 MB or smaller" }, 413);
  }
  const stored = await storeLogo(c.env, c.get("userId"), bytes);
  if (!stored) {
    return c.json({ error: "Upload a PNG, JPEG or WebP image" }, 415);
  }
  return c.json(stored);
});

// The bytes R2 actually returned for a ranged read, or null when that is
// the whole file (R2 answers a range it cannot satisfy with the whole file).
// R2 reports a ranged read as a resolved offset and length.
function servedRange(object: R2ObjectBody): { offset: number; length: number } | null {
  const { offset, length } = object.range as { offset: number; length: number };
  return offset === 0 && length === object.size ? null : { offset, length };
}

function safeFilename(name: string | undefined): string | null {
  if (!name) return null;
  const cleaned = name.replace(/[^\w.-]/g, "").slice(0, 80);
  return cleaned || null;
}

filesApi.get("/files/*", async (c) => {
  const key = c.req.path.slice("/api/files/".length);
  if (!key.startsWith(userPrefix(c.get("userId"))) || key.includes("..")) {
    return c.json({ error: "Not found" }, 404);
  }
  // Videos are played in pieces (iPhones will not play one without byte
  // ranges), so a Range header is honoured.
  const ranged = c.req.header("Range") !== undefined;
  const object = await c.env.FILES.get(key, ranged ? { range: c.req.raw.headers } : undefined);
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  // Keys are unique per upload, so a stored file never changes.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  const download = safeFilename(c.req.query("download"));
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="${download}"`);
  }
  const part = ranged ? servedRange(object) : null;
  if (!part) return new Response(object.body, { headers });
  headers.set("Content-Range", `bytes ${part.offset}-${part.offset + part.length - 1}/${object.size}`);
  headers.set("Content-Length", String(part.length));
  return new Response(object.body, { status: 206, headers });
});
