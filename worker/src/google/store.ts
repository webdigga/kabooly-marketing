import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { GoogleService } from "../db/schema";
import type { Env } from "../env";
import { accessToken, decryptToken, encryptToken, revoke } from "./oauth";
import type { Granted, StateClaim } from "./oauth";

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export interface ConnectionJson {
  service: GoogleService;
  account: string;
  connectedAt: string;
}

const where = (userId: string, service: GoogleService) =>
  and(eq(schema.googleConnections.userId, userId), eq(schema.googleConnections.service, service));

// Everything a customer has connected, for the Settings screen. The token
// itself is never part of this.
export async function listConnections(env: Env, userId: string): Promise<ConnectionJson[]> {
  const rows = await db(env).select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, userId));
  return rows.map((row) => ({ service: row.service, account: row.account, connectedAt: row.createdAt.toISOString() }));
}

// Connecting again replaces whatever was there, so reconnecting a different
// Google account just works.
export async function saveConnection(env: Env, who: StateClaim, granted: Granted): Promise<void> {
  const now = new Date();
  const sealed = await encryptToken(env, granted.refreshToken);
  const row = { ...who, refreshToken: sealed, account: granted.account, createdAt: now, updatedAt: now };
  await db(env)
    .insert(schema.googleConnections)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.googleConnections.userId, schema.googleConnections.service],
      set: { refreshToken: sealed, account: granted.account, updatedAt: now },
    });
}

// Removes the connection and tells Google to forget the token. The row goes
// either way, so a customer is never stuck connected.
export async function removeConnection(env: Env, userId: string, service: GoogleService): Promise<boolean> {
  const [row] = await db(env).select().from(schema.googleConnections).where(where(userId, service));
  if (!row) return false;
  await db(env).delete(schema.googleConnections).where(where(userId, service));
  await revoke(await decryptToken(env, row.refreshToken).catch(() => ""));
  return true;
}

// A usable access token for the customer's connection, or null when they
// have not connected that service.
export async function connectionToken(env: Env, userId: string, service: GoogleService): Promise<string | null> {
  const [row] = await db(env).select().from(schema.googleConnections).where(where(userId, service));
  if (!row) return null;
  return accessToken(env, await decryptToken(env, row.refreshToken));
}
