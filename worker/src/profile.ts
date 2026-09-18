import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { readBusinessDetails } from "./copywriter";
import type { BusinessDetails } from "./copywriter";
import * as schema from "./db/schema";
import { PLATFORMS } from "./db/schema";
import type { Platform } from "./db/schema";
import type { Env } from "./env";
import { brandPrefix, fileUrl, storeLogo, userPrefix } from "./files";
import { beginGeneration, deniedResponse, isDenied } from "./limits";
import { scanWebsite } from "./scan";
import type { LogoFind } from "./scan/logo";
import { normaliseWebsiteUrl } from "./scan/url";
import type { AppEnv } from "./session";
import { parseJson } from "./validation";

export interface Profile {
  businessName: string;
  description: string;
  websiteUrl: string | null;
  targetAudience: string;
  localArea: string;
  tone: number;
  services: string[];
  brandColours: string[];
  logoKey: string | null;
  brandStrips: Partial<Record<Platform, string>> | null;
}

export const MAX_SERVICES = 20;
export const MAX_BRAND_COLOURS = 5;

export async function loadProfile(env: Env, userId: string): Promise<Profile | null> {
  const db = drizzle(env.DB, { schema });
  const [row] = await db
    .select()
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.userId, userId));
  if (!row) return null;
  const services = await db
    .select({ name: schema.profileServices.name })
    .from(schema.profileServices)
    .where(eq(schema.profileServices.userId, userId))
    .orderBy(asc(schema.profileServices.position));
  return {
    businessName: row.businessName,
    description: row.description,
    websiteUrl: row.websiteUrl,
    targetAudience: row.targetAudience,
    localArea: row.localArea,
    tone: row.tone,
    services: services.map((s) => s.name),
    brandColours: row.brandColours,
    logoKey: row.logoKey,
    brandStrips: row.brandStrips ?? null,
  };
}

function toJson(profile: Profile) {
  const { brandStrips: _strips, ...shown } = profile;
  return { ...shown, logoUrl: profile.logoKey ? fileUrl(profile.logoKey) : null };
}

const profileBody = z.object({
  businessName: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(1000),
  websiteUrl: z.string().trim().max(300).nullable(),
  targetAudience: z.string().trim().min(1).max(500),
  localArea: z.string().trim().min(1).max(200),
  tone: z.number().int().min(1).max(5),
  services: z.array(z.string().trim().min(1).max(100)).min(1).max(MAX_SERVICES),
  brandColours: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i))
    .max(MAX_BRAND_COLOURS),
  logoKey: z.string().max(300).nullable(),
  // One strip per platform, drawn and uploaded by the browser just before
  // saving.
  brandStrips: z.partialRecord(z.enum(PLATFORMS), z.string().max(300)).nullish(),
});

type ProfileBody = z.infer<typeof profileBody>;

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// A file must be one this account uploaded (or the scan stored for it).
async function owns(env: Env, userId: string, key: string, prefix: string): Promise<boolean> {
  if (!key.startsWith(prefix) || key.includes("..")) return false;
  return (await env.FILES.head(key)) !== null;
}

async function saveProfile(
  env: Env,
  userId: string,
  body: ProfileBody,
  websiteUrl: string | null
): Promise<Profile> {
  const db = drizzle(env.DB, { schema });
  const now = new Date();
  const values = {
    businessName: body.businessName,
    description: body.description,
    websiteUrl,
    targetAudience: body.targetAudience,
    localArea: body.localArea,
    tone: body.tone,
    brandColours: body.brandColours.map((c) => c.toLowerCase()),
    logoKey: body.logoKey,
    brandStrips: body.brandStrips ?? null,
    updatedAt: now,
  };
  const services = uniqueCaseInsensitive(body.services).map((name, position) => ({
    id: crypto.randomUUID(),
    userId,
    name,
    position,
    createdAt: now,
  }));
  await db.batch([
    db
      .insert(schema.businessProfiles)
      .values({ userId, createdAt: now, ...values })
      .onConflictDoUpdate({ target: schema.businessProfiles.userId, set: values }),
    db.delete(schema.profileServices).where(eq(schema.profileServices.userId, userId)),
    db.insert(schema.profileServices).values(services),
  ]);
  return { ...values, services: services.map((s) => s.name) };
}

export const profileApi = new Hono<AppEnv>();

profileApi.get("/profile", async (c) => {
  const profile = await loadProfile(c.env, c.get("userId"));
  return c.json({ profile: profile ? toJson(profile) : null });
});

// Saving settles which logo and brand strip an account uses, so every other
// file in those folders (a replaced one, or one a scan stored and the user
// never kept) goes.
async function removeOtherFiles(env: Env, userId: string, prefix: string, keep: (string | null)[]): Promise<void> {
  const listed = await env.FILES.list({ prefix });
  const stale = listed.objects.map((o) => o.key).filter((key) => !keep.includes(key));
  if (stale.length) await env.FILES.delete(stale);
}

// Checks the parts zod cannot: the website is a real public address and
// the logo belongs to this account. Returns the offending field, if any.
async function invalidField(env: Env, userId: string, body: ProfileBody): Promise<string | null> {
  if (body.websiteUrl && !normaliseWebsiteUrl(body.websiteUrl)) return "websiteUrl";
  if (body.logoKey && !(await owns(env, userId, body.logoKey, `${userPrefix(userId)}logos/`))) return "logoKey";
  for (const key of Object.values(body.brandStrips ?? {})) {
    if (!(await owns(env, userId, key, brandPrefix(userId)))) return "brandStrips";
  }
  return null;
}

profileApi.put("/profile", async (c) => {
  const parsed = await parseJson(c, profileBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const userId = c.get("userId");
  const field = await invalidField(c.env, userId, body);
  if (field) return c.json({ error: "Invalid request", field }, 400);

  const websiteUrl = body.websiteUrl ? normaliseWebsiteUrl(body.websiteUrl) : null;
  const saved = await saveProfile(c.env, userId, body, websiteUrl?.toString() ?? null);
  await removeOtherFiles(c.env, userId, `${userPrefix(userId)}logos/`, [saved.logoKey]);
  await removeOtherFiles(c.env, userId, brandPrefix(userId), Object.values(saved.brandStrips ?? {}));
  return c.json({ profile: toJson(saved) });
});

// The rest of the profile, read from the website's words. Best effort like
// the rest of the scan: no words or a failed read is simply nothing found.
async function readDetails(env: Env, url: URL, pageText: string): Promise<BusinessDetails | null> {
  if (!pageText.trim()) return null;
  try {
    return await readBusinessDetails(env, url.toString(), pageText);
  } catch (err) {
    console.error("could not read business details", err);
    return null;
  }
}

interface KeptLogo {
  logo: { key: string; url: string } | null;
  // An SVG is sent back for the browser to rasterise, which it does better
  // than the Worker can.
  svg: string | null;
}

// Stores the logo the scan found, falling back to its second choice when
// the best one is in a format that will not convert.
async function keepLogo(env: Env, userId: string, find: LogoFind | null): Promise<KeptLogo> {
  const none: KeptLogo = { logo: null, svg: null };
  if (!find) return none;
  for (const found of [find.best, find.safe]) {
    if (!found) continue;
    if (found.kind === "svg") return { logo: null, svg: found.svg };
    const stored = await storeLogo(env, userId, found.bytes);
    if (stored) return { logo: stored, svg: null };
  }
  return none;
}

const scanBody = z.object({ url: z.string().max(300) });

profileApi.post("/profile/scan", async (c) => {
  const parsed = await parseJson(c, scanBody);
  if (!parsed.ok) return parsed.response;
  const url = normaliseWebsiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Invalid request", field: "url" }, 400);

  // Reading a website makes the Worker fetch someone else's site, so it
  // counts against the same generous text allowance as topic suggestions.
  const lease = await beginGeneration(c.env, c.get("userId"), { kind: "text", units: 0, holdLock: false });
  if (isDenied(lease)) return deniedResponse(c, lease);
  const outcome = await scanWebsite(url).finally(() => lease.finish(0));
  const [found, details] = await Promise.all([
    keepLogo(c.env, c.get("userId"), outcome.logo),
    readDetails(c.env, url, outcome.pageText),
  ]);
  return c.json({
    websiteUrl: url.toString(),
    reachable: outcome.reachable,
    colours: outcome.colours,
    logo: found.logo,
    logoSvg: found.svg,
    details,
  });
});
