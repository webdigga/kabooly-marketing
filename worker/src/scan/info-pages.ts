import type { PageLink } from "./page";
import { resolveUrl } from "./url";

const MAX_PAGES = 2;

// Words that mark a page describing the business or what it sells, best
// first. Checked against a link's words and its path.
const SIGNALS: { pattern: RegExp; score: number }[] = [
  { pattern: /\bservices?\b|what we do|treatments?|our work/i, score: 3 },
  { pattern: /\babout\b|who we are|our story/i, score: 2 },
  { pattern: /\bproducts?\b|\bmenu\b|prices|pricing/i, score: 1 },
];

function score(link: PageLink, url: URL): number {
  const words = `${link.text} ${url.pathname.replace(/[-_/]/g, " ")}`;
  return Math.max(0, ...SIGNALS.filter((s) => s.pattern.test(words)).map((s) => s.score));
}

// Up to two pages on the same site that are likely to say what the business
// does: a services page and an about page when both exist.
export function findInfoPages(links: PageLink[], base: string): string[] {
  const home = new URL(base);
  const seen = new Set([`${home.origin}${home.pathname}`]);
  const ranked: { url: string; score: number }[] = [];
  for (const link of links) {
    const resolved = resolveUrl(link.href, base);
    if (!resolved) continue;
    const url = new URL(resolved);
    const key = `${url.origin}${url.pathname}`;
    if (url.hostname !== home.hostname || seen.has(key)) continue;
    seen.add(key);
    const value = score(link, url);
    if (value > 0) ranked.push({ url: key, score: value });
  }
  const chosen: { url: string; score: number }[] = [];
  for (const page of ranked.sort((a, b) => b.score - a.score)) {
    if (chosen.length < MAX_PAGES && !chosen.some((c) => c.score === page.score)) chosen.push(page);
  }
  return chosen.map((c) => c.url);
}
