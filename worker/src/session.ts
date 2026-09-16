import { createMiddleware } from "hono/factory";
import { createAuth } from "./auth";
import { hasAccess } from "./billing";
import type { Env } from "./env";

export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string };
}

// Every app route needs a signed-in account with a verified email and an
// active subscription (or the founder's account). TrackShows
// only gates verification in the client (old native builds could not show a
// verify screen); this app has no such clients, so the server enforces it.
export const requireVerifiedUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  if (!session.user.emailVerified) {
    return c.json({ error: "Email not verified" }, 403);
  }
  if (!(await hasAccess(c.env, session.user))) {
    return c.json({ error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE" }, 402);
  }
  c.set("userId", session.user.id);
  await next();
});
