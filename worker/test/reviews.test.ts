import { beforeEach, describe, expect, it } from "vitest";
import { isGoogleReviewUrl, newSlug, requestMessage } from "../src/reviews";
import { mockClaude } from "./ai-mocks";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, appFetch, mockEmail, verifiedUser, withProfile } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
});

const LINK = "/api/review-link";
const REQUEST = "/api/review-request";
const GOOGLE = "https://g.page/r/CbAcMeCleaning/review";

interface RequestJson {
  link: { slug: string; target: string } | null;
  url: string | null;
  message: string | null;
}

async function save(cookie: string, target: string): Promise<Response> {
  return apiFetch(cookie, LINK, { method: "PUT", body: { target } });
}

async function request(cookie: string): Promise<RequestJson> {
  return (await apiFetch(cookie, REQUEST)).json();
}

describe("the review request link", () => {
  it("mints a short link, hands back the words to send, and sends people to Google", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    expect(await request(cookie)).toEqual({ link: null, url: null, message: null });

    expect((await save(cookie, GOOGLE)).status).toBe(200);
    const body = await request(cookie);
    expect(body.url).toBe(`http://localhost/r/${body.link?.slug ?? ""}`);
    expect(body.message).toContain("Acme Cleaning");
    expect(body.message).toContain(body.url ?? "");

    // The public side: no session, straight to Google.
    const followed = await appFetch(`/r/${body.link?.slug ?? ""}`, { redirect: "manual" });
    expect(followed.status).toBe(302);
    expect(followed.headers.get("Location")).toBe(GOOGLE);
    expect(followed.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps the slug when the Google address changes, so printed codes still work", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    await save(cookie, GOOGLE);
    const first = await request(cookie);
    await save(cookie, "https://search.google.com/local/writereview?placeid=abc");
    const second = await request(cookie);
    expect(second.link?.slug).toBe(first.link?.slug);
    const followed = await appFetch(`/r/${second.link?.slug ?? ""}`, { redirect: "manual" });
    expect(followed.headers.get("Location")).toBe("https://search.google.com/local/writereview?placeid=abc");
  });

  it("refuses anything that is not a Google address, so the link cannot be pointed elsewhere", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    for (const bad of ["https://example.com/reviews", "http://g.page/r/acme/review", "not a url", "https://g.page.evil.com/x"]) {
      const res = await save(cookie, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "not_google" });
    }
    expect((await save(cookie, "")).status).toBe(400);
    expect((await request(cookie)).link).toBeNull();
  });

  it("can be removed, and the short link stops working", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    await save(cookie, GOOGLE);
    const { link } = await request(cookie);
    expect(await (await apiFetch(cookie, LINK, { method: "DELETE" })).json()).toEqual({ removed: true });
    const gone = await appFetch(`/r/${link?.slug ?? ""}`);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain("no longer in use");
  });

  it("works before the business profile is filled in", async () => {
    const { cookie } = await verifiedUser();
    await save(cookie, GOOGLE);
    const body = await request(cookie);
    expect(body.message).toContain("Thanks for choosing us.");
  });

  it("keeps one account's link away from another", async () => {
    const { cookie } = await verifiedUser();
    const other = await verifiedUser("other");
    await withProfile(cookie);
    await save(cookie, GOOGLE);
    expect((await request(other.cookie)).link).toBeNull();
  });
});

describe("the parts on their own", () => {
  it("accepts every address Google hands out and nothing else", () => {
    expect(isGoogleReviewUrl("https://g.page/r/acme/review")).toBe(true);
    expect(isGoogleReviewUrl("https://maps.app.goo.gl/abc")).toBe(true);
    expect(isGoogleReviewUrl("https://www.google.com/maps/place/acme")).toBe(true);
    expect(isGoogleReviewUrl("https://business.google.com/reviews")).toBe(true);
    expect(isGoogleReviewUrl("https://notgoogle.com/x")).toBe(false);
  });

  it("makes slugs that are short and free of letters people mix up", () => {
    const slug = newSlug();
    expect(slug).toMatch(/^[a-hjkmnp-z2-9]{7}$/);
    expect(new Set(Array.from({ length: 50 }, () => newSlug())).size).toBe(50);
  });

  it("writes a message a customer can send as it is", () => {
    const message = requestMessage("Acme Cleaning", "http://localhost/r/abc");
    expect(message).toContain("Thanks for choosing Acme Cleaning.");
    expect(message.endsWith("http://localhost/r/abc")).toBe(true);
  });
});
