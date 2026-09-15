import type { Platform } from "./db/schema";
import type { Env } from "./env";
import { sniffRaster } from "./files";
import { PLATFORM_SPECS } from "./platforms";
import type { Profile } from "./profile";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TIMEOUT_MS = 120_000;

export class ImageError extends Error {}

interface ContentItem {
  type?: string;
  data?: string;
}

interface InteractionResponse {
  status?: string;
  steps?: { type?: string; content?: ContentItem[] }[];
}

export interface Logo {
  mimeType: string;
  base64: string;
}

function base64ToBytes(base64: string): Uint8Array {
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

export function imagePrompt(
  profile: Profile,
  topic: string,
  platform: Platform,
  hasLogo: boolean
): string {
  const spec = PLATFORM_SPECS[platform];
  const lines = [
    `Create an eye-catching ${spec.label} advert image for ${profile.businessName}, a small business.`,
    `What the business does: ${profile.description}`,
    `Area served: ${profile.localArea}`,
    `The advert is about: ${topic}`,
    `Audience: ${profile.targetAudience}`,
    "Style: clean, modern and professional, suitable for a small local business. Realistic photography or a polished graphic, whichever suits the topic.",
    "Do not add any words, slogans, prices, phone numbers or other text to the image.",
  ];
  if (profile.brandColours.length) {
    lines.push(`Use the brand colours ${profile.brandColours.join(", ")} prominently as accents.`);
  }
  if (hasLogo) {
    lines.push(
      "The attached image is the business logo. Place it once, small and clearly legible in a corner, reproduced exactly as given without redrawing or altering it."
    );
  }
  if (spec.aspectRatio === "16:9") {
    lines.push("Keep the key subject and the logo away from the top and bottom edges; the image will be cropped slightly there.");
  }
  return lines.join("\n");
}

function firstImage(body: InteractionResponse): string | null {
  for (const step of body.steps ?? []) {
    const image = step.content?.find((item) => item.type === "image" && item.data);
    if (image?.data) return image.data;
  }
  return null;
}

// Asks Gemini for one image. Returns raw bytes at Gemini's own size.
export async function generateImage(
  env: Env,
  prompt: string,
  platform: Platform,
  logo: Logo | null
): Promise<Uint8Array> {
  const input: Record<string, string>[] = [{ type: "text", text: prompt }];
  if (logo) input.push({ type: "image", mime_type: logo.mimeType, data: logo.base64 });
  const res = await fetch(INTERACTIONS_URL, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GEMINI_IMAGE_MODEL,
      input,
      response_format: {
        type: "image",
        mime_type: "image/jpeg",
        aspect_ratio: PLATFORM_SPECS[platform].aspectRatio,
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

// Crops and scales to the platform's exact pixel size.
export async function fitToPlatform(
  env: Env,
  bytes: Uint8Array,
  platform: Platform
): Promise<Uint8Array> {
  const { width, height } = PLATFORM_SPECS[platform];
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const result = await env.IMAGES.input(source)
    .transform({ width, height, fit: "cover" })
    .output({ format: "image/jpeg", quality: 90 });
  return new Uint8Array(await result.response().arrayBuffer());
}
