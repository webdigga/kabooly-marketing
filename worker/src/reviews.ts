import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { parseJson } from "./validation";
import { loadProfile } from "./profile";
import type { AppEnv } from "./session";

export const reviewsApi = new Hono<AppEnv>();

// The short link is on Kabooly's own domain, so it must only ever send
// people to Google. Anything else would turn it into an open redirect for
// whatever a customer pasted in.
const GOOGLE_HOSTS = ["g.page", "search.google.com", "maps.app.goo.gl", "goo.gl", "google.com", "maps.google.com"];

export function isGoogleReviewUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  return GOOGLE_HOSTS.includes(host) || host.endsWith(".google.com");
}

const SLUG_LENGTH = 7;
const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

// Short enough to type off a card, and without the characters people
// mistake for each other.
export function newSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SLUG_LENGTH));
  return Array.from(bytes, (b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export interface ReviewLink {
  slug: string;
  target: string;
}

export async function loadReviewLink(env: Env, userId: string): Promise<ReviewLink | null> {
  const [row] = await db(env).select().from(schema.reviewLinks).where(eq(schema.reviewLinks.userId, userId));
  return row ? { slug: row.slug, target: row.target } : null;
}

const linkBody = z.object({ target: z.string().trim().min(1).max(500) });

// Saving a new address keeps the slug, so anything already printed or
// texted out carries on working.
reviewsApi.put("/review-link", async (c) => {
  const parsed = await parseJson(c, linkBody);
  if (!parsed.ok) return parsed.response;
  const target = parsed.data.target;
  if (!isGoogleReviewUrl(target)) {
    return c.json({ error: "That is not a Google address. Paste the review link from your Google Business Profile.", code: "not_google" }, 400);
  }
  const userId = c.get("userId");
  const now = new Date();
  const existing = await loadReviewLink(c.env, userId);
  const slug = existing?.slug ?? newSlug();
  await db(c.env)
    .insert(schema.reviewLinks)
    .values({ userId, slug, target, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: schema.reviewLinks.userId, set: { target, updatedAt: now } });
  return c.json({ link: { slug, target } });
});

reviewsApi.delete("/review-link", async (c) => {
  await db(c.env).delete(schema.reviewLinks).where(eq(schema.reviewLinks.userId, c.get("userId")));
  return c.json({ removed: true });
});

// The public side: /r/{slug}, which anyone can follow. It is deliberately
// outside /api so it is short enough to print, and it needs no session.
export const shortLinkApi = new Hono<{ Bindings: Env }>();

shortLinkApi.get("/r/:slug", async (c) => {
  const [row] = await drizzle(c.env.DB, { schema })
    .select()
    .from(schema.reviewLinks)
    .where(eq(schema.reviewLinks.slug, c.req.param("slug")));
  if (!row) return c.text("That link is no longer in use.", 404);
  // Short lived: a customer can change where it points at any time.
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect(row.target, 302);
});

// The words to send with the link. Written here rather than by a model: it
// is three sentences, and the customer can edit them anyway.
export function requestMessage(businessName: string, link: string): string {
  return [
    `Thanks for choosing ${businessName}.`,
    "If we did a good job, would you leave us a quick Google review? It takes a minute and it genuinely helps a small business like ours.",
    link,
  ].join("\n\n");
}

reviewsApi.get("/review-request", async (c) => {
  const profile = await loadProfile(c.env, c.get("userId"));
  const link = await loadReviewLink(c.env, c.get("userId"));
  const url = link ? `${c.env.BETTER_AUTH_URL.replace(/\/$/, "")}/r/${link.slug}` : null;
  return c.json({
    link,
    url,
    message: url ? requestMessage(profile?.businessName ?? "us", url) : null,
  });
});
