import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { setSubscriptionState, statusGrantsAccess } from "./billing";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { verifyStripeSignature } from "./stripe-signature";

// Keeps standalone Marketing subscriptions (Stripe metadata plan=marketing)
// in step with Stripe. Bundle subscriptions are ignored here: the CRM
// webhook switches bundle access through /api/internal/bundle-access.

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id?: unknown; status?: unknown; metadata?: Record<string, unknown> | null } };
}

function parseEvent(payload: string): StripeEvent | null {
  try {
    const event = JSON.parse(payload) as Partial<StripeEvent>;
    if (typeof event.id !== "string" || typeof event.type !== "string" || !event.data?.object) return null;
    return event as StripeEvent;
  } catch {
    return null;
  }
}

async function applyEvent(env: Env, event: StripeEvent): Promise<void> {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return;
  const subscription = event.data.object;
  if (subscription.metadata?.plan !== "marketing" || typeof subscription.id !== "string") return;

  let status = typeof subscription.status === "string" ? subscription.status : "unknown";
  if (event.type === "customer.subscription.deleted") status = "canceled";
  await setSubscriptionState(env, subscription.id, { status, active: statusGrantsAccess(status) });
}

export const stripeWebhookApi = new Hono<{ Bindings: Env }>();

stripeWebhookApi.post("/", async (c) => {
  const payload = await c.req.text();
  const header = c.req.header("Stripe-Signature");
  if (!header || !(await verifyStripeSignature(payload, header, c.env.STRIPE_WEBHOOK_SECRET))) {
    return c.json({ error: "Invalid signature" }, 400);
  }
  const event = parseEvent(payload);
  if (!event) return c.json({ error: "Invalid event" }, 400);

  const db = drizzle(c.env.DB, { schema });
  // Claim the event first; a retried delivery finds it and stops.
  const claimed = await db
    .insert(schema.billingEvents)
    .values({ stripeEventId: event.id, type: event.type, receivedAt: new Date() })
    .onConflictDoNothing()
    .run();
  if (claimed.meta.changes === 0) return c.json({ received: true, duplicate: true });

  try {
    await applyEvent(c.env, event);
  } catch (err) {
    // Release the claim so Stripe's retry processes it again.
    await c.env.DB.prepare("DELETE FROM billing_events WHERE stripe_event_id = ?1").bind(event.id).run();
    console.error("stripe webhook failed", err);
    return c.json({ error: "Processing failed" }, 500);
  }
  return c.json({ received: true });
});
