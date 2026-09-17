import { Hono } from "hono";
import { advertsApi } from "./adverts";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { filesApi } from "./files";
import { profileApi } from "./profile";
import { internalApi } from "./provision";
import { stripeWebhookApi } from "./stripe-webhook";
import type { AppEnv } from "./session";
import { requireVerifiedUser } from "./session";

export { GenerationLimiter } from "./limiter";

// Only /api/* reaches this app (run_worker_first in wrangler.toml); every
// other path is served from the static assets.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

// Server-to-server: checkout provisioning, CRM bundle access, Stripe events.
app.route("/api/internal", internalApi);
app.route("/api/stripe/webhook", stripeWebhookApi);

const api = new Hono<AppEnv>();
api.use("*", requireVerifiedUser);
api.route("/", profileApi);
api.route("/", filesApi);
api.route("/", advertsApi);
api.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
