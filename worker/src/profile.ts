import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { fileUrl, storeLogo, userPrefix } from "./files";
import { scanWebsite } from "./scan";
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
  };
}

function toJson(profile: Profile) {
  return { ...profile, logoUrl: profile.logoKey ? fileUrl(profile.logoKey) : null };
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

// A logo must be one this account uploaded (or the scan stored for it).
async function ownsLogo(env: Env, userId: string, key: string): Promise<boolean> {
  if (!key.startsWith(`${userPrefix(userId)}logos/`) || key.includes("..")) return false;
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

// Checks the parts zod cannot: the website is a real public address and
// the logo belongs to this account. Returns the offending field, if any.
async function invalidField(env: Env, userId: string, body: ProfileBody): Promise<string | null> {
  if (body.websiteUrl && !normaliseWebsiteUrl(body.websiteUrl)) return "websiteUrl";
  if (body.logoKey && !(await ownsLogo(env, userId, body.logoKey))) return "logoKey";
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
  const previous = await loadProfile(c.env, userId);
  const saved = await saveProfile(c.env, userId, body, websiteUrl?.toString() ?? null);
  if (previous?.logoKey && previous.logoKey !== body.logoKey) {
    await c.env.FILES.delete(previous.logoKey);
  }
  return c.json({ profile: toJson(saved) });
});

const scanBody = z.object({ url: z.string().max(300) });

profileApi.post("/profile/scan", async (c) => {
  const parsed = await parseJson(c, scanBody);
  if (!parsed.ok) return parsed.response;
  const url = normaliseWebsiteUrl(parsed.data.url);
  if (!url) return c.json({ error: "Invalid request", field: "url" }, 400);

  const outcome = await scanWebsite(url);
  const logo =
    outcome.logo?.kind === "raster"
      ? await storeLogo(c.env, c.get("userId"), outcome.logo.bytes)
      : null;
  return c.json({
    websiteUrl: url.toString(),
    reachable: outcome.reachable,
    colours: outcome.colours,
    logo,
    logoSvg: outcome.logo?.kind === "svg" ? outcome.logo.svg : null,
  });
});
