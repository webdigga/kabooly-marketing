import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { userPrefix } from "./files";
import type { AppEnv } from "./session";

const DELETE_BATCH = 100;

// Every file an account owns lives under its own prefix, so emptying that
// prefix removes its logos and advert images.
async function deleteFiles(env: Env, userId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix: userPrefix(userId), cursor, limit: DELETE_BATCH });
    if (listed.objects.length) await env.FILES.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export const accountApi = new Hono<AppEnv>();

// Deleting the user row cascades to sessions, sign-in methods, the business
// profile, services, adverts and image rows.
accountApi.delete("/account", async (c) => {
  const userId = c.get("userId");
  await deleteFiles(c.env, userId);
  await drizzle(c.env.DB, { schema }).delete(schema.user).where(eq(schema.user.id, userId));
  return c.json({ ok: true });
});
