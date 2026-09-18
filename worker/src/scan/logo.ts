import { MAX_LOGO_BYTES, sniffRaster } from "../files";
import { decodeText, fetchLimited } from "./fetch-limited";
import type { IconLink, PageFacts } from "./page";
import { resolveUrl } from "./url";

export type FoundLogo =
  | { kind: "raster"; bytes: Uint8Array }
  | { kind: "svg"; svg: string }
  // An image in some other format (AVIF, for one), which the Worker tries
  // to convert before falling back to the next candidate.
  | { kind: "other"; bytes: Uint8Array };

export interface LogoFind {
  // The best candidate on the page, whatever its format.
  best: FoundLogo;
  // The best candidate that needs no converting, when the best one does.
  safe: FoundLogo | null;
}

const MAX_ATTEMPTS = 5;
const MAX_SVG_BYTES = 300_000;

interface Candidate {
  href: string;
  score: number;
}

function largestSize(sizes: string): number {
  return Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
}

function iconScore(icon: IconLink): number {
  if (icon.rel.includes("apple-touch-icon")) return 40;
  if (largestSize(icon.sizes) >= 96) return 35;
  if (icon.href.toLowerCase().includes(".svg")) return 30;
  // .ico files cannot be used as a logo anywhere downstream.
  if (icon.href.toLowerCase().includes(".ico")) return 0;
  return 20;
}

// Best guess first: an image marked as a logo (better still, in the
// header), then the first header image, then the larger site icons.
export function rankLogoCandidates(facts: PageFacts, pageUrl: string): string[] {
  const candidates: Candidate[] = [];
  let headerImageSeen = false;
  for (const image of facts.images) {
    if (image.logoish) {
      candidates.push({ href: image.src, score: image.inHeader ? 120 : 100 });
    } else if (image.inHeader && !headerImageSeen) {
      headerImageSeen = true;
      candidates.push({ href: image.src, score: 50 });
    }
  }
  for (const icon of facts.icons) {
    candidates.push({ href: icon.href, score: iconScore(icon) });
  }
  candidates.push({ href: "/apple-touch-icon.png", score: 10 });

  const urls = candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => resolveUrl(c.href, pageUrl))
    .filter((u): u is string => u !== null);
  return [...new Set(urls)].slice(0, MAX_ATTEMPTS);
}

function asSvg(contentType: string, bytes: Uint8Array): string | null {
  if (bytes.byteLength > MAX_SVG_BYTES) return null;
  const text = decodeText(bytes);
  const looksSvg = contentType.includes("svg") || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text);
  return looksSvg && text.includes("<svg") ? text : null;
}

function classify(contentType: string, bytes: Uint8Array): FoundLogo | null {
  if (sniffRaster(bytes)) return { kind: "raster", bytes };
  const type = contentType.toLowerCase();
  // An SVG too large to keep is passed over rather than handed on as
  // something to convert.
  if (type.includes("svg")) {
    const svg = asSvg(contentType, bytes);
    return svg ? { kind: "svg", svg } : null;
  }
  const svg = asSvg(contentType, bytes);
  if (svg) return { kind: "svg", svg };
  return type.startsWith("image/") ? { kind: "other", bytes } : null;
}

// The best logo on the page, plus a second choice to fall back on when the
// best one is in a format that turns out not to convert.
export async function fetchFirstLogo(urls: string[]): Promise<LogoFind | null> {
  let best: FoundLogo | null = null;
  for (const url of urls) {
    const res = await fetchLimited(url, "image/*", MAX_LOGO_BYTES);
    if (!res) continue;
    const found = classify(res.contentType, res.bytes);
    if (!found) continue;
    if (!best) {
      if (found.kind !== "other") return { best: found, safe: null };
      best = found;
      continue;
    }
    if (found.kind !== "other") return { best, safe: found };
  }
  return best ? { best, safe: null } : null;
}
