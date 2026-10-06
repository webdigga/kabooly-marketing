import { beforeEach, describe, expect, it } from "vitest";
import { hostOf, periods, pickSite, slippedPages } from "../src/search-console";
import { ANTHROPIC_URL, KEYWORD_IDEAS, mockClaude } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockEmail, testEnv, verifiedUser, withProfile } from "./helpers";
import { REVOKE_URL, TOKEN_URL, USERINFO_URL } from "../src/google/oauth";

const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";
const QUERY_URL = "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aacme-cleaning.co.uk/searchAnalytics/query";
const OVERVIEW = "/api/search-console/overview";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
});

// A connected account with a business profile, which is what the panel needs.
async function connected(overrides: Record<string, unknown> = {}): Promise<string> {
  const { cookie } = await verifiedUser();
  await withProfile(cookie, overrides);
  onFetch(TOKEN_URL, () => Response.json({ access_token: "access-1", refresh_token: "refresh-1" }));
  onFetch(USERINFO_URL, () => Response.json({ email: "david@kabooly.com" }));
  onFetch(REVOKE_URL, () => new Response("{}"));
  const start = await apiFetch(cookie, "/api/google/search_console/connect", { manualRedirect: true });
  const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
  await apiFetch(cookie, `/api/google/callback?code=c&state=${state ?? ""}`, { manualRedirect: true });
  return cookie;
}

function mockSites(entries: { siteUrl: string; permissionLevel?: string }[]): void {
  onFetch(SITES_URL, () => Response.json({ siteEntry: entries }));
}

const TOTALS = { clicks: 120, impressions: 4000, position: 12.34 };
const BEFORE = { clicks: 90, impressions: 3000, position: 15.0 };

// The five calls the overview makes, answered by what each one asks for.
function mockFigures(): void {
  onFetch(QUERY_URL, async (req) => {
    const body = JSON.parse((await req.text()) || "{}") as { dimensions?: string[]; startDate?: string };
    const isBefore = body.startDate === periods().before.start;
    if (!body.dimensions) return Response.json({ rows: [{ ...(isBefore ? BEFORE : TOTALS) }] });
    if (body.dimensions[0] === "query") {
      return Response.json({
        rows: [
          { keys: ["oven cleaning twickenham"], clicks: 80, impressions: 900, position: 2.1 },
          { keys: ["end of tenancy clean"], clicks: 5, impressions: 1200, position: 14.6 },
          { keys: ["carpet cleaner near me"], clicks: 1, impressions: 400, position: 9.2 },
          { keys: ["cleaner"], clicks: 0, impressions: 50, position: 48.0 },
        ],
      });
    }
    return Response.json({
      rows: isBefore
        ? [{ keys: ["https://acme-cleaning.co.uk/ovens"], position: 4.0 }]
        : [{ keys: ["https://acme-cleaning.co.uk/ovens"], position: 9.5 }],
    });
  });
}

interface Overview {
  site: string;
  totals: typeof TOTALS;
  before: typeof TOTALS;
  topQueries: { query: string; position: number }[];
  nearly: { query: string }[];
  slipped: { page: string; position: number; was: number }[];
}

describe("the search panel", () => {
  it("reports the figures, what is nearly ranking and what slipped", async () => {
    const cookie = await connected({ websiteUrl: "https://www.acme-cleaning.co.uk/prices" });
    mockSites([{ siteUrl: "https://acme-cleaning.co.uk/" }, { siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    mockFigures();
    const res = await apiFetch(cookie, OVERVIEW);
    expect(res.status).toBe(200);
    const body: Overview = await res.json();
    // A domain property covers every subdomain, so it wins over the URL one.
    expect(body.site).toBe("sc-domain:acme-cleaning.co.uk");
    expect(body.totals).toEqual({ clicks: 120, impressions: 4000, position: 12.3 });
    expect(body.before).toEqual({ clicks: 90, impressions: 3000, position: 15 });
    expect(body.topQueries[0]?.query).toBe("oven cleaning twickenham");
    // Page two, worth a nudge; position 48 is not, and position 2 is already there.
    expect(body.nearly.map((n) => n.query)).toEqual(["end of tenancy clean", "carpet cleaner near me"]);
    expect(body.slipped).toEqual([{ page: "https://acme-cleaning.co.uk/ovens", position: 9.5, was: 4 }]);
    // One list call plus the five windows of figures.
    expect(callsTo(QUERY_URL)).toHaveLength(5);
  });

  it("asks for the four whole weeks Google has finished counting", () => {
    const { now, before } = periods();
    expect(new Date(now.end) < new Date()).toBe(true);
    expect((new Date(now.end).getTime() - new Date(now.start).getTime()) / 86_400_000).toBe(27);
    expect(new Date(before.end) < new Date(now.start)).toBe(true);
  });

  it("explains itself when there is nothing it can read", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    const notConnected = await apiFetch(cookie, OVERVIEW);
    expect(notConnected.status).toBe(409);
    expect(await notConnected.json()).toMatchObject({ code: "not_connected" });

    const blank = await connected({ websiteUrl: null });
    expect(await (await apiFetch(blank, OVERVIEW)).json()).toMatchObject({ code: "no_website" });

    const mine = await connected();
    mockSites([{ siteUrl: "sc-domain:someone-else.co.uk" }]);
    expect(await (await apiFetch(mine, OVERVIEW)).json()).toMatchObject({ code: "no_property" });

    // A Google account with no properties at all answers without the list.
    onFetch(SITES_URL, () => Response.json({}));
    expect(await (await apiFetch(mine, OVERVIEW)).json()).toMatchObject({ code: "no_property" });
  });

  it("needs a business profile first", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, OVERVIEW);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_profile" });
  });

  it("answers 500 when Google refuses or cannot be reached", async () => {
    const cookie = await connected();
    onFetch(SITES_URL, () => new Response("no", { status: 403 }));
    expect((await apiFetch(cookie, OVERVIEW)).status).toBe(500);
    onFetch(SITES_URL, () => {
      throw new Error("network down");
    });
    expect((await apiFetch(cookie, OVERVIEW)).status).toBe(500);
  });

  it("copes with a property that has no figures at all", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    onFetch(QUERY_URL, () => Response.json({}));
    const body: Overview = await (await apiFetch(cookie, OVERVIEW)).json();
    expect(body.totals).toEqual({ clicks: 0, impressions: 0, position: 0 });
    expect(body.topQueries).toEqual([]);
    expect(body.nearly).toEqual([]);
    expect(body.slipped).toEqual([]);
  });

  it("copes with rows Google sends back half empty", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    onFetch(QUERY_URL, () => Response.json({ rows: [{}] }));
    const body: Overview = await (await apiFetch(cookie, OVERVIEW)).json();
    expect(body.totals).toEqual({ clicks: 0, impressions: 0, position: 0 });
    expect(body.topQueries).toEqual([{ query: "", clicks: 0, impressions: 0, position: 0 }]);
    expect(body.nearly).toEqual([]);
  });
});

describe("keyword ideas", () => {
  const IDEAS = "/api/search-console/ideas";

  it("works them out from the real searches and says what the numbers show", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    mockFigures();
    const res = await apiFetch(cookie, IDEAS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ideas: KEYWORD_IDEAS });
    const asked = callsTo(ANTHROPIC_URL).at(-1)?.body ?? "";
    expect(asked).toContain("end of tenancy clean | shown 1200 | visits 5 | place 14.6");
    expect(asked).toContain("Acme Cleaning");
  });

  it("asks for a connection and a property first, like the panel does", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    expect(await (await apiFetch(cookie, IDEAS)).json()).toMatchObject({ code: "not_connected" });
  });

  it("says so when Google has recorded almost nothing", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    // One search, below the threshold worth writing about.
    onFetch(QUERY_URL, () => Response.json({ rows: [{ keys: ["acme cleaning"], impressions: 2, clicks: 0, position: 1 }] }));
    const res = await apiFetch(cookie, IDEAS);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "no_searches" });
  });

  it("answers 502 when the model fails", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    mockFigures();
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 400 }));
    const res = await apiFetch(cookie, IDEAS);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "The ideas could not be worked out. Try again." });
  });
});

describe("matching the property", () => {
  it("ignores www, the scheme, a path and a property it cannot read", () => {
    expect(hostOf("sc-domain:acme.co.uk")).toBe("acme.co.uk");
    expect(hostOf("https://www.acme.co.uk/prices")).toBe("acme.co.uk");
    expect(hostOf("acme.co.uk")).toBe("acme.co.uk");
    expect(hostOf("not a url at all")).toBe("");
    expect(pickSite([{ siteUrl: "https://acme.co.uk/", permissionLevel: "siteUnverifiedUser" }], "acme.co.uk")).toBeNull();
    expect(pickSite([{ siteUrl: "https://acme.co.uk/" }], "acme.co.uk")).toBe("https://acme.co.uk/");
    expect(pickSite([{}], "acme.co.uk")).toBeNull();
    expect(pickSite([{ siteUrl: "https://acme.co.uk/" }], "")).toBeNull();
  });
});

describe("slipped pages", () => {
  it("leaves out pages that are new, steady or barely moved", () => {
    const rows = [
      { keys: ["/new"], position: 20 },
      { keys: ["/steady"], position: 5 },
      { keys: ["/wobble"], position: 6.5 },
      { keys: ["/gone"], position: 30 },
    ];
    const before = [
      { keys: ["/steady"], position: 5 },
      { keys: ["/wobble"], position: 5 },
      { keys: ["/gone"], position: 8 },
    ];
    expect(slippedPages(rows, before).map((p) => p.page)).toEqual(["/gone"]);
    expect(slippedPages([{ clicks: 1 }], [{ clicks: 1 }])).toEqual([]);
  });

  it("puts the biggest drop first", () => {
    const now = [
      { keys: ["/small"], position: 9 },
      { keys: ["/big"], position: 25 },
    ];
    const before = [
      { keys: ["/small"], position: 5 },
      { keys: ["/big"], position: 6 },
    ];
    expect(slippedPages(now, before).map((p) => p.page)).toEqual(["/big", "/small"]);
  });
});

describe("the access token", () => {
  it("is fetched fresh for every read", async () => {
    const cookie = await connected();
    mockSites([{ siteUrl: "sc-domain:acme-cleaning.co.uk" }]);
    mockFigures();
    await apiFetch(cookie, OVERVIEW);
    expect(callsTo(TOKEN_URL).at(-1)?.body).toContain("grant_type=refresh_token");
    expect(testEnv).toBeDefined();
  });
});
