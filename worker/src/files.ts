import { Hono } from "hono";
import type { Env } from "./env";
import type { AppEnv } from "./session";

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

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

export async function storeLogo(
  env: Env,
  userId: string,
  bytes: Uint8Array
): Promise<{ key: string; url: string } | null> {
  const type = sniffRaster(bytes);
  if (!type || bytes.byteLength > MAX_LOGO_BYTES) return null;
  const key = `${userPrefix(userId)}logos/${crypto.randomUUID()}.${EXTENSIONS[type]}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  return { key, url: fileUrl(key) };
}

export const filesApi = new Hono<AppEnv>();

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
  const object = await c.env.FILES.get(key);
  if (!object) return c.json({ error: "Not found" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  // Keys are unique per upload, so a stored file never changes.
  headers.set("Cache-Control", "private, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  const download = safeFilename(c.req.query("download"));
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="${download}"`);
  }
  return new Response(object.body, { headers });
});
