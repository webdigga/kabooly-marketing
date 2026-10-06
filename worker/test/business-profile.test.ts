import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS_URL, findPlace, INFO_BASE, REVIEWS_BASE, reviewJson } from "../src/business-profile";
import { REVOKE_URL, TOKEN_URL, USERINFO_URL } from "../src/google/oauth";
import { ANTHROPIC_URL, mockClaude, REVIEW_REPLY } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockEmail, verifiedUser, withProfile } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
});

const REVIEWS = "/api/reviews";
const REPLY = "/api/reviews/reply";
const LOCATIONS_URL = `${INFO_BASE}/accounts/123/locations`;
const REVIEWS_URL = `${REVIEWS_BASE}/accounts/123/locations/456/reviews`;

// A connected Business Profile account with a business profile saved.
async function connected(): Promise<string> {
  const { cookie } = await verifiedUser();
  await withProfile(cookie);
  onFetch(TOKEN_URL, () => Response.json({ access_token: "access-1", refresh_token: "refresh-1" }));
  onFetch(USERINFO_URL, () => Response.json({ email: "david@kabooly.com" }));
  onFetch(REVOKE_URL, () => new Response("{}"));
  const start = await apiFetch(cookie, "/api/google/business_profile/connect", { manualRedirect: true });
  const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
  await apiFetch(cookie, `/api/google/callback?code=c&state=${state ?? ""}`, { manualRedirect: true });
  return cookie;
}

function mockPlace(): void {
  onFetch(ACCOUNTS_URL, () => Response.json({ accounts: [{ name: "accounts/123" }] }));
  onFetch(LOCATIONS_URL, () => Response.json({ locations: [{ name: "locations/456", title: "Acme Cleaning, Twickenham" }] }));
}

const GOOGLE_REVIEWS = {
  reviews: [
    {
      reviewId: "r1",
      reviewer: { displayName: "Jane Clark" },
      starRating: "FIVE",
      comment: "Spotless oven, booked again.",
      createTime: "2026-10-01T10:00:00Z",
    },
    {
      reviewId: "r2",
      reviewer: { displayName: "Sam" },
      starRating: "TWO",
      comment: "Turned up late.",
      createTime: "2026-09-20T10:00:00Z",
      updateTime: "2026-09-21T10:00:00Z",
      reviewReply: { comment: "Sorry about that, Sam." },
    },
  ],
};

interface ReviewsJson {
  place: string;
  reviews: { id: string; author: string; rating: number; comment: string | null; at: string; reply: string | null }[];
}

describe("the reviews list", () => {
  it("finds the business and brings its reviews back in plain shape", async () => {
    const cookie = await connected();
    mockPlace();
    onFetch(REVIEWS_URL, () => Response.json(GOOGLE_REVIEWS));
    const res = await apiFetch(cookie, REVIEWS);
    expect(res.status).toBe(200);
    const body: ReviewsJson = await res.json();
    expect(body.place).toBe("Acme Cleaning, Twickenham");
    expect(body.reviews[0]).toEqual({
      id: "r1",
      author: "Jane Clark",
      rating: 5,
      comment: "Spotless oven, booked again.",
      at: "2026-10-01T10:00:00Z",
      reply: null,
    });
    expect(body.reviews[1]).toMatchObject({ rating: 2, reply: "Sorry about that, Sam.", at: "2026-09-21T10:00:00Z" });
    // Newest first, as Google was asked for them.
    expect(callsTo(REVIEWS_URL)[0]?.url).toContain("orderBy=updateTime");
  });

  it("asks for a connection before anything else", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    const res = await apiFetch(cookie, REVIEWS);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_connected" });
  });

  it("says so when the Google account manages no listing", async () => {
    const cookie = await connected();
    onFetch(ACCOUNTS_URL, () => Response.json({}));
    expect(await (await apiFetch(cookie, REVIEWS)).json()).toMatchObject({ code: "no_location" });

    // An account with a location that has no name is no use either.
    onFetch(ACCOUNTS_URL, () => Response.json({ accounts: [{ name: "accounts/123" }, {}] }));
    onFetch(LOCATIONS_URL, () => Response.json({ locations: [{ title: "Nameless" }] }));
    expect(await (await apiFetch(cookie, REVIEWS)).json()).toMatchObject({ code: "no_location" });
  });

  it("answers 500 when Google refuses or cannot be reached", async () => {
    const cookie = await connected();
    onFetch(ACCOUNTS_URL, () => new Response("no", { status: 403 }));
    expect((await apiFetch(cookie, REVIEWS)).status).toBe(500);
    onFetch(ACCOUNTS_URL, () => {
      throw new Error("network down");
    });
    expect((await apiFetch(cookie, REVIEWS)).status).toBe(500);
  });

  it("names a location Google gave no title, and copes with an empty location list", async () => {
    const cookie = await connected();
    onFetch(ACCOUNTS_URL, () => Response.json({ accounts: [{ name: "accounts/123" }] }));
    onFetch(LOCATIONS_URL, () => Response.json({ locations: [{ name: "locations/456" }] }));
    onFetch(REVIEWS_URL, () => Response.json({}));
    expect(await (await apiFetch(cookie, REVIEWS)).json()).toMatchObject({ place: "Your business" });

    onFetch(LOCATIONS_URL, () => Response.json({}));
    expect(await (await apiFetch(cookie, REVIEWS)).json()).toMatchObject({ code: "no_location" });
  });

  it("copes with a listing that has no reviews", async () => {
    const cookie = await connected();
    mockPlace();
    onFetch(REVIEWS_URL, () => Response.json({}));
    expect(await (await apiFetch(cookie, REVIEWS)).json()).toMatchObject({ reviews: [] });
  });
});

describe("drafting a reply", () => {
  it("writes one in the business's voice and hands it back as text", async () => {
    const cookie = await connected();
    const res = await apiFetch(cookie, REPLY, {
      method: "POST",
      body: { author: "Jane Clark", rating: 5, comment: "Spotless oven, booked again." },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: REVIEW_REPLY });
    const asked = callsTo(ANTHROPIC_URL).at(-1)?.body ?? "";
    expect(asked).toContain("Jane Clark");
    expect(asked).toContain("Spotless oven");
    expect(asked).toContain("Acme Cleaning");
    // Nothing is sent to Google: no reply call anywhere.
    expect(callsTo(REVIEWS_BASE)).toHaveLength(0);
  });

  it("handles a rating with no words, and needs a profile", async () => {
    const cookie = await connected();
    const res = await apiFetch(cookie, REPLY, { method: "POST", body: { author: "Sam", rating: 4, comment: null } });
    expect(res.status).toBe(200);
    expect(callsTo(ANTHROPIC_URL).at(-1)?.body).toContain("nothing, a rating only");

    const { cookie: fresh } = await verifiedUser("fresh");
    const refused = await apiFetch(fresh, REPLY, { method: "POST", body: { author: "Sam", rating: 4, comment: null } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "no_profile" });
  });

  it("tells the model when the reviewer left no name", async () => {
    const cookie = await connected();
    await apiFetch(cookie, REPLY, { method: "POST", body: { author: "", rating: 5, comment: "Great." } });
    expect(callsTo(ANTHROPIC_URL).at(-1)?.body).toContain("not given");
  });

  it("validates the review it is given", async () => {
    const cookie = await connected();
    for (const bad of [{ author: "Sam", rating: 9, comment: null }, { rating: 4, comment: null }, { author: "Sam", rating: 0 }]) {
      expect((await apiFetch(cookie, REPLY, { method: "POST", body: bad })).status).toBe(400);
    }
  });

  it("answers 502 when the model fails", async () => {
    const cookie = await connected();
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 400 }));
    const res = await apiFetch(cookie, REPLY, { method: "POST", body: { author: "Sam", rating: 4, comment: null } });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "That reply could not be written. Try again." });
  });
});

describe("the parts on their own", () => {
  it("fills in whatever Google leaves out of a review", () => {
    expect(reviewJson({})).toEqual({ id: "", author: "A customer", rating: 0, comment: null, at: "", reply: null });
    expect(reviewJson({ comment: "   ", reviewReply: { comment: "  " } })).toMatchObject({ comment: null, reply: null });
    expect(reviewJson({ starRating: "THREE" })).toMatchObject({ rating: 3 });
  });

  it("gives nothing when the token can see no accounts", async () => {
    onFetch(ACCOUNTS_URL, () => Response.json({ accounts: [] }));
    expect(await findPlace("token")).toBeNull();
  });
});
