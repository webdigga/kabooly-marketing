import { Hono } from "hono";
import { GOOGLE_SERVICES } from "./db/schema";
import type { GoogleService } from "./db/schema";
import { authUrl, exchangeCode, readState, signState } from "./google/oauth";
import { listConnections, removeConnection, saveConnection } from "./google/store";
import type { AppEnv } from "./session";

export const googleApi = new Hono<AppEnv>();

// Where the customer lands after Google sends them back, with a plain
// outcome in the query so Settings can say what happened.
const SETTINGS = "/settings";

function isService(value: string): value is GoogleService {
  return (GOOGLE_SERVICES as readonly string[]).includes(value);
}

googleApi.get("/google/connections", async (c) => {
  return c.json({ connections: await listConnections(c.env, c.get("userId")) });
});

// Step one: a plain link in Settings lands here and this redirects on to
// Google's consent screen, so the browser navigates once and the app needs
// no script to start the flow.
googleApi.get("/google/:service/connect", async (c) => {
  const service = c.req.param("service");
  if (!isService(service)) return c.json({ error: "Not found" }, 404);
  const state = await signState(c.env, c.get("userId"), service);
  return c.redirect(authUrl(c.env, service, state), 302);
});

// Step two: Google's redirect back. It is a browser navigation, so it always
// answers with a redirect to Settings rather than JSON.
googleApi.get("/google/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (error || !code || !state) return c.redirect(`${SETTINGS}?google=refused`, 302);
  const claim = await readState(c.env, state);
  // The signed state carries the account that started the flow, which must
  // still be the one signed in.
  if (claim?.userId !== c.get("userId")) return c.redirect(`${SETTINGS}?google=expired`, 302);
  try {
    const granted = await exchangeCode(c.env, code);
    await saveConnection(c.env, claim, granted);
  } catch (err) {
    console.error("Google connection failed", err);
    return c.redirect(`${SETTINGS}?google=failed`, 302);
  }
  return c.redirect(`${SETTINGS}?google=connected`, 302);
});

// Disconnecting always works: the row goes, and telling Google to forget
// the token is best effort (removeConnection).
googleApi.delete("/google/:service", async (c) => {
  const service = c.req.param("service");
  if (!isService(service)) return c.json({ error: "Not found" }, 404);
  return c.json({ removed: await removeConnection(c.env, c.get("userId"), service) });
});
