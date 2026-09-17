import type { Platform } from "./db/schema";
import type { Env } from "./env";
import { sniffRaster } from "./files";
import { PLATFORM_SPECS } from "./platforms";
import type { AspectRatio, Shape } from "./platforms";
import type { Profile } from "./profile";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TIMEOUT_MS = 120_000;

export class ImageError extends Error {}

export interface ContentItem {
  type?: string;
  data?: string;
  uri?: string;
}

export interface InteractionResponse {
  id?: string;
  status?: string;
  steps?: { type?: string; content?: ContentItem[] }[];
}

export interface Logo {
  mimeType: string;
  base64: string;
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// The lines every image prompt shares: the business, the brief, and how to
// use the brand colours and logo.
function briefLines(profile: Profile, topic: string, hasLogo: boolean): string[] {
  const lines = [
    `What the business does: ${profile.description}`,
    `Area served: ${profile.localArea}`,
    `The advert is about: ${topic}`,
    `Audience: ${profile.targetAudience}`,
  ];
  if (profile.brandColours.length) {
    lines.push(
      `Where it looks natural, echo the brand colours ${profile.brandColours.join(", ")} in props, clothing or surroundings. Keep all colours realistic: no colour filters, tints or recolouring of the scene.`
    );
  }
  if (hasLogo) {
    lines.push(
      "The attached image is the business logo. Place it once, small, in a clear corner away from faces and the main subject. Copy it exactly: same shapes, letters and colours, never redrawn, restyled or recoloured."
    );
  }
  return lines;
}

// Guards against what spoils a realistic advert photo: graphic add-ons and
// broken anatomy.
const REALISM = [
  "Style: a realistic, professional photograph of a real scene, as a skilled photographer would shoot it, with natural light.",
  "Do not add icons, symbols, emoji, illustrations, stickers, motion lines, speech bubbles, badges, frames or any other graphic elements.",
  "Any people must look natural and anatomically correct: two arms, two hands, five fingers on each hand, natural faces.",
];

const NO_TEXT = "Do not add any words, slogans, prices, phone numbers or other text to the image.";

export function imagePrompt(
  profile: Profile,
  topic: string,
  platform: Platform,
  hasLogo: boolean
): string {
  const spec = PLATFORM_SPECS[platform];
  const lines = [
    `Create an eye-catching ${spec.label} advert image for ${profile.businessName}, a small business.`,
    ...briefLines(profile, topic, hasLogo),
    ...REALISM,
    NO_TEXT,
  ];
  if (spec.aspectRatio === "16:9") {
    lines.push("Keep the key subject and the logo away from the top and bottom edges; the image will be cropped slightly there.");
  }
  return lines.join("\n");
}

// The first frame of a vertical video: the planned hook scene, so the video
// opens on it.
export function videoStartPrompt(profile: Profile, topic: string, scene: string, hasLogo: boolean): string {
  return [
    `Create a vertical 9:16 opening frame for a short social media video advert for ${profile.businessName}, a small business.`,
    ...briefLines(profile, topic, hasLogo),
    `The scene: ${scene}`,
    ...REALISM,
    NO_TEXT,
  ].join("\n");
}

// The photograph on a carousel's first slide. The app lays the words over
// its lower part and adds the real logo elsewhere, so it must be a plain
// photograph: asking it to leave room for text makes it paint hazy panels.
export function carouselBackgroundPrompt(profile: Profile, topic: string): string {
  return [
    `Create a 4:5 photograph for the first slide of a social media carousel for ${profile.businessName}, a small business.`,
    ...briefLines(profile, topic, false),
    ...REALISM,
    "Full bleed, edge to edge. Do not add panels, boxes, borders, fog or blur effects.",
    NO_TEXT,
    "Do not include any logo.",
  ].join("\n");
}

function firstOutput(body: InteractionResponse, type: string): ContentItem | null {
  for (const step of body.steps ?? []) {
    const item = step.content?.find((c) => c.type === type && (c.data ?? c.uri));
    if (item) return item;
  }
  return null;
}

export function firstImage(body: InteractionResponse): string | null {
  return firstOutput(body, "image")?.data ?? null;
}

export function firstVideo(body: InteractionResponse): ContentItem | null {
  return firstOutput(body, "video");
}

export function logoInput(logo: Logo): Record<string, string> {
  return { type: "image", mime_type: logo.mimeType, data: logo.base64 };
}

// Asks Gemini for one image. Returns raw bytes at Gemini's own size.
export async function generateImage(
  env: Env,
  prompt: string,
  aspectRatio: AspectRatio,
  logo: Logo | null
): Promise<Uint8Array> {
  const input: Record<string, string>[] = [{ type: "text", text: prompt }];
  if (logo) input.push(logoInput(logo));
  const res = await fetch(INTERACTIONS_URL, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GEMINI_IMAGE_MODEL,
      input,
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: aspectRatio,
        image_size: "2K",
      },
      // Customer business details stay out of Google's interaction store.
      store: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new ImageError(`Gemini request failed: ${String(err)}`);
  });
  if (!res.ok) {
    throw new ImageError(`Gemini returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = firstImage(await res.json());
  if (!data) throw new ImageError("Gemini returned no image");
  const bytes = base64ToBytes(data);
  if (!sniffRaster(bytes)) throw new ImageError("Gemini returned an unreadable image");
  return bytes;
}

async function jpegOf(transformer: ImageTransformer): Promise<Uint8Array> {
  const result = await transformer.output({ format: "image/jpeg", quality: 90 });
  return new Uint8Array(await result.response().arrayBuffer());
}

// Crops and scales to an exact pixel size.
export async function fitToShape(env: Env, bytes: Uint8Array, shape: Shape): Promise<Uint8Array> {
  return jpegOf(
    env.IMAGES.input(streamOf(bytes)).transform({ width: shape.width, height: shape.height, fit: "cover" })
  );
}

export async function fitToPlatform(
  env: Env,
  bytes: Uint8Array,
  platform: Platform
): Promise<Uint8Array> {
  return fitToShape(env, bytes, PLATFORM_SPECS[platform]);
}

/* eslint-disable no-bitwise -- CRC-32 is defined in terms of bit operations */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/* eslint-enable no-bitwise */

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// A 1x1 PNG of one colour (#rrggbb), stretched by the Images binding into a
// solid bar: the binding has no "fill a rectangle" operation.
export async function solidPng(hex: string): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, 1);
  new DataView(header.buffer).setUint32(4, 1);
  header.set([8, 2, 0, 0, 0], 8);
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  const scanline = new Uint8Array([0, channel(1), channel(3), channel(5)]);
  const compressed = new Uint8Array(
    await new Response(streamOf(scanline).pipeThrough(new CompressionStream("deflate"))).arrayBuffer()
  );
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

// Share of the image height the logo strip takes, and its brand-coloured
// top edge in pixels.
const STRIP_SHARE = 0.12;
const STRIP_EDGE = 8;

export interface Branding {
  logo: Uint8Array | null;
  colour: string | null;
}

// A customer's own photo, cropped to a platform's size around its most
// interesting part. With a logo, the real logo file sits centred on a white
// strip along the bottom, edged in the first brand colour. The photo itself
// is never altered.
export async function brandPhoto(
  env: Env,
  photo: Uint8Array,
  platform: Platform,
  branding: Branding
): Promise<Uint8Array> {
  const { width, height } = PLATFORM_SPECS[platform];
  let image = env.IMAGES.input(streamOf(photo)).transform({ width, height, fit: "cover", gravity: "auto" });
  if (branding.logo) {
    const strip = Math.round(height * STRIP_SHARE);
    const edge = env.IMAGES.input(streamOf(await solidPng(branding.colour ?? "#ffffff"))).transform({
      width,
      height: strip + STRIP_EDGE,
      fit: "squeeze",
    });
    const logo = env.IMAGES.input(streamOf(branding.logo)).transform({
      width,
      height: strip,
      fit: "pad",
      background: "#ffffff",
    });
    image = image.draw(edge, { bottom: 0, left: 0 }).draw(logo, { bottom: 0, left: 0 });
  }
  return jpegOf(image);
}
