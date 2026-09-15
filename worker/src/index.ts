import { Hono } from "hono";
import type { Env } from "./env";

// Only /api/* reaches this app (run_worker_first in wrangler.toml); every
// other path is served from the static assets.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
