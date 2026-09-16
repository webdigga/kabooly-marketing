import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";

const ACCESS_STATUSES = new Set(["active", "trialing"]);

export function statusGrantsAccess(status: string): boolean {
  return ACCESS_STATUSES.has(status);
}

// Accounts are paid, never free. The founder's own account is the one
// exception, so David keeps using the tool without a subscription.
export async function hasAccess(env: Env, user: { id: string; email: string }): Promise<boolean> {
  if (user.email.toLowerCase() === env.FOUNDER_LOGIN_EMAIL.toLowerCase()) return true;
  const row = await drizzle(env.DB, { schema })
    .select({ active: schema.subscriptions.active })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, user.id))
    .get();
  return row?.active === true;
}

// Returns true when a row changed; an unknown subscription is not an error.
export async function setSubscriptionState(
  env: Env,
  stripeSubscriptionId: string,
  state: { status: string; active: boolean }
): Promise<boolean> {
  const result = await drizzle(env.DB, { schema })
    .update(schema.subscriptions)
    .set({ ...state, updatedAt: new Date() })
    .where(eq(schema.subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .run();
  return result.meta.changes > 0;
}
