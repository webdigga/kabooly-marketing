import type { Platform } from "./db/schema";

export interface PlatformSpec {
  label: string;
  width: number;
  height: number;
  // Closest shape Gemini can draw; the result is then cropped to size.
  aspectRatio: "1:1" | "16:9";
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  instagram: { label: "Instagram", width: 1080, height: 1080, aspectRatio: "1:1" },
  facebook: { label: "Facebook", width: 1200, height: 630, aspectRatio: "16:9" },
  nextdoor: { label: "Nextdoor", width: 1200, height: 1200, aspectRatio: "1:1" },
};
