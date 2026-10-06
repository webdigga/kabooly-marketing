import { Hono } from "hono";
import { connectionToken } from "./google/store";
import { GoogleError } from "./google/oauth";
import { requireProfile } from "./profile";
import type { AppEnv } from "./session";

export const searchConsoleApi = new Hono<AppEnv>();

export const SC_BASE = "https://www.googleapis.com/webmasters/v3";

// Google finishes counting a day two or three days late, so the window ends
// three days ago rather than today.
const LAG_DAYS = 3;
const WINDOW_DAYS = 28;
const ROWS = 25;
const SHOWN = 5;
// Page two of Google: worth a nudge, where position 40 is not.
const NEARLY_BEST = 8;
const NEARLY_WORST = 20;
// Three places is more than day-to-day wobble.
const SLIP = 3;

interface Site {
  siteUrl?: string;
  permissionLevel?: string;
}

interface Row {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  position?: number;
}

interface QueryResponse {
  rows?: Row[];
}

export interface Period {
  start: string;
  end: string;
}

function day(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

// The last four whole weeks of data, and the four weeks before them.
export function periods(): { now: Period; before: Period } {
  return {
    now: { start: day(LAG_DAYS + WINDOW_DAYS - 1), end: day(LAG_DAYS) },
    before: { start: day(LAG_DAYS + WINDOW_DAYS * 2 - 1), end: day(LAG_DAYS + WINDOW_DAYS) },
  };
}

// "https://www.acme.co.uk/prices" and "sc-domain:acme.co.uk" both come down
// to acme.co.uk, which is what a property is matched on.
export function hostOf(value: string): string {
  const bare = value.startsWith("sc-domain:") ? value.slice("sc-domain:".length) : value;
  const withScheme = /^https?:\/\//i.test(bare) ? bare : `https://${bare}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

// The customer's own website among the properties their Google account can
// see. A domain property wins, because it covers every subdomain and both
// schemes.
export function pickSite(sites: Site[], websiteUrl: string): string | null {
  const wanted = hostOf(websiteUrl);
  if (!wanted) return null;
  const mine = sites.filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser" && hostOf(s.siteUrl) === wanted);
  const domain = mine.find((s) => s.siteUrl?.startsWith("sc-domain:"));
  return (domain ?? mine[0])?.siteUrl ?? null;
}

async function ask(url: string, init: RequestInit, what: string): Promise<unknown> {
  const res = await fetch(url, init).catch((err: unknown) => {
    throw new GoogleError(`Search Console request failed: ${String(err)}`);
  });
  if (!res.ok) throw new GoogleError(`Search Console returned ${res.status} for ${what}`);
  return res.json();
}

export async function listSites(token: string): Promise<Site[]> {
  const body = (await ask(`${SC_BASE}/sites`, { headers: { Authorization: `Bearer ${token}` } }, "the site list")) as {
    siteEntry?: Site[];
  };
  return body.siteEntry ?? [];
}

// Google's own field names for a window, which are not the ones the panel
// shows.
function window(period: Period): Record<string, string> {
  return { startDate: period.start, endDate: period.end };
}

async function query(token: string, site: string, body: Record<string, unknown>): Promise<Row[]> {
  const answer = (await ask(
    `${SC_BASE}/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    "the search figures"
  )) as QueryResponse;
  return answer.rows ?? [];
}

export interface Totals {
  clicks: number;
  impressions: number;
  position: number;
}

function totalsOf(rows: Row[]): Totals {
  const row = rows[0];
  return {
    clicks: Math.round(row?.clicks ?? 0),
    impressions: Math.round(row?.impressions ?? 0),
    position: Number((row?.position ?? 0).toFixed(1)),
  };
}

export interface QueryLine {
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

function lineOf(row: Row): QueryLine {
  return {
    query: row.keys?.[0] ?? "",
    clicks: Math.round(row.clicks ?? 0),
    impressions: Math.round(row.impressions ?? 0),
    position: Number((row.position ?? 0).toFixed(1)),
  };
}

export interface SlippedPage {
  page: string;
  position: number;
  was: number;
}

// Pages that sat higher four weeks ago. Only pages Google still shows, and
// only drops big enough to mean something.
export function slippedPages(now: Row[], before: Row[]): SlippedPage[] {
  const was = new Map(before.map((row) => [row.keys?.[0] ?? "", row.position ?? 0]));
  return now
    .map((row) => ({ page: row.keys?.[0] ?? "", position: row.position ?? 0, was: was.get(row.keys?.[0] ?? "") ?? 0 }))
    .filter((p) => p.was > 0 && p.position - p.was >= SLIP)
    .sort((a, b) => b.position - b.was - (a.position - a.was))
    .slice(0, SHOWN)
    .map((p) => ({ page: p.page, position: Number(p.position.toFixed(1)), was: Number(p.was.toFixed(1)) }));
}

// Searches the business already shows up for, just too far down to be found.
export function nearlyThere(rows: Row[]): QueryLine[] {
  return rows
    .map(lineOf)
    .filter((line) => line.position >= NEARLY_BEST && line.position <= NEARLY_WORST)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, SHOWN);
}

searchConsoleApi.get("/search-console/overview", async (c) => {
  const profile = await requireProfile(c);
  if (profile instanceof Response) return profile;
  const token = await connectionToken(c.env, c.get("userId"), "search_console");
  if (!token) return c.json({ error: "Connect Google Search Console first", code: "not_connected" }, 409);
  if (!profile.websiteUrl) return c.json({ error: "Add your website address first", code: "no_website" }, 409);

  const site = pickSite(await listSites(token), profile.websiteUrl);
  if (!site) return c.json({ error: "That Google account cannot see your website", code: "no_property" }, 409);

  const { now, before } = periods();
  const [totals, totalsBefore, queries, pages, pagesBefore] = await Promise.all([
    query(token, site, window(now)),
    query(token, site, window(before)),
    query(token, site, { ...window(now), dimensions: ["query"], rowLimit: ROWS }),
    query(token, site, { ...window(now), dimensions: ["page"], rowLimit: ROWS }),
    query(token, site, { ...window(before), dimensions: ["page"], rowLimit: ROWS }),
  ]);

  const lines = queries.map(lineOf);
  return c.json({
    site,
    period: now,
    totals: totalsOf(totals),
    before: totalsOf(totalsBefore),
    topQueries: lines.slice(0, SHOWN * 2),
    nearly: nearlyThere(queries),
    slipped: slippedPages(pages, pagesBefore),
  });
});
