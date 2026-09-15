// Brand colour detection from a site's CSS. Colours are scored by where
// they appear: the theme-color meta and brand-named custom properties
// (--primary, --brand-...) count far more than an incidental border.

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Scored {
  rgb: Rgb;
  weight: number;
}

export const MAX_COLOURS = 4;
const SIMILAR_DISTANCE = 48;
const THEME_COLOUR_WEIGHT = 20;
const BRAND_PROPERTY_WEIGHT = 8;
const PAINT_PROPERTY_WEIGHT = 2;

const BRAND_PROPERTY = /^--.*(primary|brand|accent|secondary|main|theme|highlight)/i;
const PAINT_PROPERTY = /^(background|background-color|color|fill|border-color|border|stroke)$/i;
const COLOUR_TOKEN =
  /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;
const DECLARATION = /([\w-]+)\s*:\s*([^;{}]+)/g;

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

function parseHex(token: string): Rgb | null {
  let hex = token.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.replace(/./g, "$&$&");
  }
  // #rrggbbaa: anything mostly transparent is not a brand colour.
  if (hex.length === 8 && parseInt(hex.slice(6, 8), 16) < 128) return null;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

// Splits "rgb(1 2 3 / 50%)" or "rgba(1, 2, 3, .5)" into its numbers.
function functionArgs(token: string): { values: string[]; alpha: number } {
  const inner = token.slice(token.indexOf("(") + 1, -1);
  const parts = inner.split(/[\s,/]+/).filter(Boolean);
  const alphaPart = parts[3];
  const alpha = alphaPart
    ? parseFloat(alphaPart) / (alphaPart.endsWith("%") ? 100 : 1)
    : 1;
  return { values: parts.slice(0, 3), alpha };
}

function channel(value: string): number {
  return value.endsWith("%") ? (parseFloat(value) / 100) * 255 : parseFloat(value);
}

function parseRgb(token: string): Rgb | null {
  const { values, alpha } = functionArgs(token);
  if (values.length < 3 || alpha < 0.5) return null;
  const [r, g, b] = values.map(channel) as [number, number, number];
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: clampByte(f(0) * 255), g: clampByte(f(8) * 255), b: clampByte(f(4) * 255) };
}

function parseHsl(token: string): Rgb | null {
  const { values, alpha } = functionArgs(token);
  if (values.length < 3 || alpha < 0.5) return null;
  const [h, s, l] = values.map((v) => parseFloat(v)) as [number, number, number];
  if ([h, s, l].some(Number.isNaN)) return null;
  return hslToRgb(((h % 360) + 360) % 360, s / 100, l / 100);
}

export function parseColour(token: string): Rgb | null {
  const lower = token.toLowerCase();
  if (lower.startsWith("#")) return parseHex(lower);
  if (lower.startsWith("rgb")) return parseRgb(lower);
  return parseHsl(lower);
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// Greys, near-white and near-black are page furniture, not brand colours.
function isBrandCandidate({ r, g, b }: Rgb): boolean {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  if (lightness > 0.94 || lightness < 0.08) return false;
  const saturation =
    max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  return saturation >= 0.2;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function add(pool: Scored[], rgb: Rgb, weight: number): void {
  if (!isBrandCandidate(rgb)) return;
  const near = pool.find((s) => distance(s.rgb, rgb) < SIMILAR_DISTANCE);
  if (near) {
    near.weight += weight;
    return;
  }
  pool.push({ rgb, weight });
}

function weightFor(property: string): number {
  if (BRAND_PROPERTY.test(property)) return BRAND_PROPERTY_WEIGHT;
  if (PAINT_PROPERTY.test(property)) return PAINT_PROPERTY_WEIGHT;
  return 1;
}

function addFromValue(pool: Scored[], value: string, weight: number): void {
  for (const token of value.match(COLOUR_TOKEN) ?? []) {
    const rgb = parseColour(token);
    if (rgb) add(pool, rgb, weight);
  }
}

export function detectBrandColours(
  cssChunks: string[],
  themeColours: string[]
): string[] {
  const pool: Scored[] = [];
  for (const theme of themeColours) addFromValue(pool, theme, THEME_COLOUR_WEIGHT);
  for (const css of cssChunks) {
    for (const match of css.matchAll(DECLARATION)) {
      addFromValue(pool, String(match[2]), weightFor(String(match[1])));
    }
  }
  return pool
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_COLOURS)
    .map((s) => toHex(s.rgb));
}
