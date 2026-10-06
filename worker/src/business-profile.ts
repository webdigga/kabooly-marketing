import { Hono } from "hono";
import { z } from "zod";
import { writeReviewReply } from "./copywriter";
import { GoogleError } from "./google/oauth";
import { connectionToken } from "./google/store";
import { limited } from "./limits";
import { requireProfile } from "./profile";
import type { AppEnv } from "./session";
import { parseJson } from "./validation";

export const businessProfileApi = new Hono<AppEnv>();

// Three Google APIs, because Business Profile was split up and reviews were
// left behind on the old one.
export const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
export const INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";

const REVIEW_PAGE = 20;

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface GoogleReview {
  reviewId?: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export interface ReviewJson {
  id: string;
  author: string;
  rating: number;
  comment: string | null;
  at: string;
  reply: string | null;
}

async function ask(url: string, token: string, what: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch((err: unknown) => {
    throw new GoogleError(`Business Profile request failed: ${String(err)}`);
  });
  if (!res.ok) throw new GoogleError(`Business Profile returned ${res.status} for ${what}`);
  return res.json();
}

export interface Place {
  // "accounts/123"
  account: string;
  // "locations/456"
  location: string;
  title: string;
}

// The business this Google account manages. Small businesses have one
// location; where there are several, the first is used and its name is
// shown, so the customer can see which one they are looking at.
export async function findPlace(token: string): Promise<Place | null> {
  const accounts = (await ask(ACCOUNTS_URL, token, "the account list")) as { accounts?: { name?: string }[] };
  for (const account of accounts.accounts ?? []) {
    if (!account.name) continue;
    const found = (await ask(
      `${INFO_BASE}/${account.name}/locations?readMask=name,title&pageSize=10`,
      token,
      "the location list"
    )) as { locations?: { name?: string; title?: string }[] };
    const location = (found.locations ?? []).find((l) => l.name);
    if (location?.name) return { account: account.name, location: location.name, title: location.title ?? "Your business" };
  }
  return null;
}

// Google leaves out anything empty, so every field has a fallback.
function or<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

export function reviewJson(review: GoogleReview): ReviewJson {
  const words = or(review.comment, "").trim();
  const reply = or(review.reviewReply?.comment, "").trim();
  return {
    id: or(review.reviewId, ""),
    author: or(review.reviewer?.displayName, "A customer"),
    rating: or(STARS[or(review.starRating, "")], 0),
    comment: words || null,
    at: or(review.updateTime, or(review.createTime, "")),
    reply: reply || null,
  };
}

export async function fetchReviews(token: string, place: Place): Promise<ReviewJson[]> {
  const body = (await ask(
    `${REVIEWS_BASE}/${place.account}/${place.location}/reviews?pageSize=${String(REVIEW_PAGE)}&orderBy=updateTime desc`,
    token,
    "the reviews"
  )) as { reviews?: GoogleReview[] };
  return (body.reviews ?? []).map(reviewJson);
}

businessProfileApi.get("/reviews", async (c) => {
  const token = await connectionToken(c.env, c.get("userId"), "business_profile");
  if (!token) return c.json({ error: "Connect Google Business Profile first", code: "not_connected" }, 409);
  const place = await findPlace(token);
  if (!place) return c.json({ error: "That Google account manages no business listing", code: "no_location" }, 409);
  const reviews = await fetchReviews(token, place);
  return c.json({ place: place.title, reviews });
});

const draftBody = z.object({
  author: z.string().trim().max(120),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).nullable(),
});

// The reply is written here and handed back as text. Nothing is posted to
// Google: the customer pastes it, like every other thing this tool makes.
businessProfileApi.post("/reviews/reply", async (c) => {
  const parsed = await parseJson(c, draftBody);
  if (!parsed.ok) return parsed.response;
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  // Writing counts against the same text allowance as advert copy.
  return limited(
    c,
    { kind: "text", units: 0, holdLock: false },
    async () => ({ response: c.json({ reply: await writeReviewReply(c.env, profile, parsed.data) }), unitsMade: 0 }),
    "That reply could not be written. Try again."
  );
});
