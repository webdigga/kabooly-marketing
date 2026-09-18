import type { Platform } from "./db/schema";

// Gemini draws the closest shape it can; the result is then cropped to the
// exact pixel size.
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:5";

export interface Shape {
  width: number;
  height: number;
  aspectRatio: AspectRatio;
}

export interface PlatformSpec extends Shape {
  label: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  instagram: { label: "Instagram", width: 1080, height: 1080, aspectRatio: "1:1" },
  facebook: { label: "Facebook", width: 1200, height: 630, aspectRatio: "16:9" },
  nextdoor: { label: "Nextdoor", width: 1200, height: 1200, aspectRatio: "1:1" },
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
