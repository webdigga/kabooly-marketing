import { createMiddleware } from "hono/factory";
import type { Env } from "./env";

// Server-to-server calls from the kabooly.com checkout and the CRM send
// `Authorization: Bearer INTERNAL_API_SECRET`. Compared in constant time.
export function isAuthorisedInternalRequest(header: string | undefined, secret: string): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const presented = encoder.encode(header.slice("Bearer ".length));
  const expected = encoder.encode(secret);
  if (presented.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(presented, expected);
}

export const requireInternalSecret = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!isAuthorisedInternalRequest(c.req.header("Authorization"), c.env.INTERNAL_API_SECRET)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
