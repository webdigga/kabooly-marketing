import type { Platform } from "./db/schema";

// Gemini draws the closest shape it can; the result is then cropped to the
// exact pixel size.
export type AspectRatio = "1:1" | "9:16" | "4:5";

export interface Shape {
  width: number;
  height: number;
  aspectRatio: AspectRatio;
}

export interface PlatformSpec extends Shape {
  label: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  // Meta recommends 4:5 at 1440 x 1800 for both feeds: it is the tallest
  // shape a feed shows without cropping, so it takes the most of the screen.
  instagram: { label: "Instagram", width: 1440, height: 1800, aspectRatio: "4:5" },
  facebook: { label: "Facebook", width: 1440, height: 1800, aspectRatio: "4:5" },
  nextdoor: { label: "Nextdoor", width: 1200, height: 1200, aspectRatio: "1:1" },
  // A Google Business Profile post. Google asks for 720x720 or larger and
  // no particular shape (checked 2026-10-06), so it takes Nextdoor's
  // square at well above the minimum.
  google: { label: "Google", width: 1200, height: 1200, aspectRatio: "1:1" },
  // A Story is full screen, carries no caption, and the browser draws the
  // words and the branding over it (nothing is stamped server-side).
  story: { label: "Instagram Story", width: 1080, height: 1920, aspectRatio: "9:16" },
};

// The first frame a video is animated from: Reels, Shorts, TikTok, Stories.
export const VIDEO_SHAPE: Shape = { width: 1080, height: 1920, aspectRatio: "9:16" };

// Instagram and Facebook carousel slides.
export const CAROUSEL_SHAPE: Shape = { width: 1080, height: 1350, aspectRatio: "4:5" };

// The brand strip along the bottom of every image: a share of the image
// width, so it carries the same weight on a square and on a wide image.
const STRIP_SHARE = 0.09;

export function stripSize(platform: Platform): { width: number; height: number } {
  const { width } = PLATFORM_SPECS[platform];
  return { width, height: Math.round(width * STRIP_SHARE) };
}
