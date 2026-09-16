import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";
import { createAuth } from "./auth";
import { setSubscriptionState, statusGrantsAccess } from "./billing";
import * as schema from "./db/schema";
import { SUBSCRIPTION_SOURCES } from "./db/schema";
import { sendEmail } from "./email";
import type { Env } from "./env";
import { requireInternalSecret } from "./internal-auth";

// Accounts are only created here, by the kabooly.com checkout after payment.
// The customer never gives checkout a password: they choose one from an
// emailed link. Idempotent on the Stripe subscription id, because Stripe
// retries the webhook that calls this.

export const SET_PASSWORD_LINK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const provisionBody = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  name: z.string().trim().max(200),
  source: z.enum(SUBSCRIPTION_SOURCES),
  stripeCustomerId: z.string().trim().min(1),
  stripeSubscriptionId: z.string().trim().min(1),
  status: z.string().trim().min(1),
});

const checkBody = z.object({ email: z.email().transform((email) => email.trim().toLowerCase()) });

const bundleAccessBody = z.object({
  stripeSubscriptionId: z.string().trim().min(1),
  active: z.boolean(),
});

type ProvisionBody = z.infer<typeof provisionBody>;

async function readBody<T>(request: Request, schemaDef: z.ZodType<T>): Promise<T | null> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schemaDef.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The same token better-auth's own reset link would create, with a longer
// life, redeemed by POST /api/auth/reset-password from the /set-password page.
async function createSetPasswordLink(env: Env, userId: string): Promise<string> {
  const context = await createAuth(env).$context;
  const token = randomToken();
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + SET_PASSWORD_LINK_DAYS * DAY_MS),
  });
  return `${env.BETTER_AUTH_URL}/set-password?token=${token}`;
}

function setPasswordEmail(body: ProvisionBody, link: string): string {
  const greeting = body.name ? `Hi ${body.name},` : "Hi,";
  const extra =
    body.source === "bundle" ? "\n\nYour Kabooly CRM login arrives in a separate email." : "";
  return `${greeting}\n\nYour Kabooly Marketing account is ready. Choose your password to sign in for the first time:\n\n${link}\n\nThis link works for ${String(SET_PASSWORD_LINK_DAYS)} days. If it runs out, use "Forgot your password?" on the sign in page.${extra}\n\nThe Kabooly Team`;
}

async function createAccount(env: Env, body: ProvisionBody): Promise<string> {
  const now = new Date();
  const userId = crypto.randomUUID();
  const db = drizzle(env.DB, { schema });
  await db.batch([
    // The address is proven by the payment, so it starts verified.
    db.insert(schema.user).values({
      id: userId,
      name: body.name,
      email: body.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(schema.subscriptions).values({
      userId,
      source: body.source,
      stripeCustomerId: body.stripeCustomerId,
      stripeSubscriptionId: body.stripeSubscriptionId,
      status: body.status,
      active: statusGrantsAccess(body.status),
      createdAt: now,
      updatedAt: now,
    }),
  ]);
  return userId;
}

async function sendSetPasswordEmail(env: Env, userId: string, body: ProvisionBody): Promise<boolean> {
  try {
    const link = await createSetPasswordLink(env, userId);
    await sendEmail(env, body.email, "Choose your Kabooly Marketing password", setPasswordEmail(body, link));
    return true;
  } catch (err) {
    console.error("set password email failed", err);
    return false;
  }
}

export const internalApi = new Hono<{ Bindings: Env }>();

internalApi.use("*", requireInternalSecret);

internalApi.post("/provision/check", async (c) => {
  const body = await readBody(c.req.raw, checkBody);
  if (!body) return c.json({ error: "Invalid request" }, 400);
  const existing = await drizzle(c.env.DB, { schema })
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, body.email))
    .get();
  return c.json({ exists: existing !== undefined });
});

internalApi.post("/provision", async (c) => {
  const body = await readBody(c.req.raw, provisionBody);
  if (!body) return c.json({ error: "Invalid request" }, 400);
  const db = drizzle(c.env.DB, { schema });

  const already = await db
    .select({ userId: schema.subscriptions.userId })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.stripeSubscriptionId, body.stripeSubscriptionId))
    .get();
  if (already) return c.json({ status: "exists", userId: already.userId });

  const taken = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, body.email)).get();
  if (taken) return c.json({ error: "email_exists" }, 409);

  const userId = await createAccount(c.env, body);
  const emailSent = await sendSetPasswordEmail(c.env, userId, body);
  return c.json({ status: "created", userId, emailSent }, 201);
});

// Called by the CRM webhook when a bundle subscription changes state.
internalApi.post("/bundle-access", async (c) => {
  const body = await readBody(c.req.raw, bundleAccessBody);
  if (!body) return c.json({ error: "Invalid request" }, 400);
  const updated = await setSubscriptionState(c.env, body.stripeSubscriptionId, {
    status: body.active ? "active" : "inactive",
    active: body.active,
  });
  return c.json({ updated });
});
