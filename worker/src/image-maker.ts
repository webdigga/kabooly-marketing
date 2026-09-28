import type { ImageStyle, Platform } from "./db/schema";
import type { Env } from "./env";
import { sniffRaster } from "./files";
import { PLATFORM_SPECS, stripSize } from "./platforms";
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

// How the brand colours are used. A photograph can only echo them, since
// the scene has to stay realistic; a design is invented outright, so the
// palette is closed, or the model reaches for its own favourite colours.
function colourLines(profile: Profile, style: ImageStyle): string[] {
  const colours = profile.brandColours.join(", ");
  if (style === "photo") {
    return profile.brandColours.length
      ? [
          `Where it looks natural, echo the brand colours ${colours} in props, clothing or surroundings. Keep all colours realistic: no colour filters, tints or recolouring of the scene.`,
        ]
      : [];
  }
  return profile.brandColours.length
    ? [
        `Palette: use only the brand colours ${colours}, plus white, black and neutral greys. Shades and tints of those brand colours are fine. Every shape, background and accent must come from that palette, and no other colour may appear anywhere in the image.`,
      ]
    : ["Palette: use one main colour with white, black and neutral greys. Keep to that one colour, in shades and tints of it."];
}

// The lines every image prompt shares: the business and the brief. The logo
// is never drawn by the model unless it was asked for: the app stamps the
// real file on afterwards (brandImage).
function briefLines(profile: Profile, topic: string): string[] {
  return [
    `What the business does: ${profile.description}`,
    `Area served: ${profile.localArea}`,
    `The advert is about: ${topic}`,
    `Audience: ${profile.targetAudience}`,
  ];
}

// Guards against what spoils a realistic advert photo: graphic add-ons and
// broken anatomy.
const REALISM = [
  "Style: a realistic, professional photograph of a real scene, as a skilled photographer would shoot it, with natural light.",
  "The photograph fills the whole frame, edge to edge. No borders, bands, blank areas, plain panels or empty space.",
  "Do not add icons, symbols, emoji, illustrations, stickers, motion lines, speech bubbles, badges, frames or any other graphic elements.",
  "Any people must look natural and anatomically correct: two arms, two hands, five fingers on each hand, natural faces.",
];

// The alternative to a photograph: a designed advert, the kind a graphic
// designer would draw, with no photorealistic people to go wrong.
const GRAPHIC = [
  "Style: a clean, modern designed graphic, the kind a graphic designer would make for a small business advert: flat shapes, simple illustration and generous space.",
  "It is a design, not a photograph: no photographic textures and no photorealistic people or faces.",
  "The design fills the whole frame, edge to edge. No borders, frames or drop shadows around the edge.",
  "Keep it simple and uncluttered: a few clear shapes, not a busy collage. No stock-art clip art, no emoji, no watermarks.",
];

const NO_TEXT = "Do not add any words, slogans, prices, phone numbers or other text to the image.";

// Used only when the customer asks for their logo in the picture. The logo
// file is sent with the prompt, and the model must copy it, never redraw it.
const WITH_LOGO = [
  "The image supplied with this prompt is the business's own logo.",
  "Place that logo into the design exactly once, reproduced exactly as supplied: same shapes, same colours, same proportions. Never redraw, restyle, recolour, crop, rotate or add to it.",
  "Put it in a clear, uncluttered area at a size that is easy to read, roughly a fifth of the width, with clear space around it. Nothing may overlap it.",
];

// The look asked for: a photograph or a designed graphic, and whether the
// model places the logo itself (which replaces the brand strip).
export interface Look {
  style: ImageStyle;
  logo: boolean;
}

function lookLines(profile: Profile, look: Look): string[] {
  return [
    ...colourLines(profile, look.style),
    ...(look.style === "graphic" ? GRAPHIC : REALISM),
    NO_TEXT,
    ...(look.logo ? WITH_LOGO : []),
  ];
}

export function imagePrompt(profile: Profile, topic: string, platform: Platform, look: Look): string {
  const spec = PLATFORM_SPECS[platform];
  const subject = look.style === "graphic" ? "designed graphic" : "photograph";
  if (platform === "story") {
    return [
      `Create a full screen vertical 9:16 ${subject} for an Instagram Story for ${profile.businessName}, a small business.`,
      ...briefLines(profile, topic),
      ...lookLines(profile, look),
      "Keep the middle of the frame clear of clutter and keep the key subject away from the top quarter and the bottom quarter: words are placed over those afterwards.",
    ].join("\n");
  }
  return [
    `Create an eye-catching ${spec.label} advert image for ${profile.businessName}, a small business, as a ${subject}.`,
    ...briefLines(profile, topic),
    ...lookLines(profile, look),
  ].join("\n");
}

// The first frame of a vertical video: the planned hook scene, so the video
// opens on it.
export function videoStartPrompt(profile: Profile, topic: string, scene: string): string {
  return [
    `Create a vertical 9:16 opening frame for a short social media video advert for ${profile.businessName}, a small business.`,
    ...briefLines(profile, topic),
    `The scene: ${scene}`,
    ...colourLines(profile, "photo"),
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
    ...briefLines(profile, topic),
    ...colourLines(profile, "photo"),
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

// Stamps the brand strip (the real logo and website address, drawn by the
// browser when the profile was saved) along the bottom of a finished image.
// Without a strip the image is returned as it is.
export async function brandImage(
  env: Env,
  image: ImageTransformer,
  platform: Platform,
  strip: Uint8Array | null
): Promise<Uint8Array> {
  if (!strip) return jpegOf(image);
  const { width, height } = stripSize(platform);
  // The browser drew it at exactly this size, so it is only squeezed back
  // to it if an older strip is a little out.
  const bar = env.IMAGES.input(streamOf(strip)).transform({ width, height, fit: "squeeze" });
  return jpegOf(image.draw(bar, { bottom: 0, left: 0 }));
}

// A generated image, cropped to the platform's exact size and branded.
export async function brandGenerated(
  env: Env,
  bytes: Uint8Array,
  platform: Platform,
  strip: Uint8Array | null
): Promise<Uint8Array> {
  const { width, height } = PLATFORM_SPECS[platform];
  const image = env.IMAGES.input(streamOf(bytes)).transform({ width, height, fit: "cover" });
  return brandImage(env, image, platform, strip);
}

// A customer's own photo, cropped to a platform's size around its most
// interesting part and branded. The photo itself is never altered.
export async function brandPhoto(
  env: Env,
  photo: Uint8Array,
  platform: Platform,
  strip: Uint8Array | null
): Promise<Uint8Array> {
  const { width, height } = PLATFORM_SPECS[platform];
  const image = env.IMAGES.input(streamOf(photo)).transform({ width, height, fit: "cover", gravity: "auto" });
  return brandImage(env, image, platform, strip);
}
