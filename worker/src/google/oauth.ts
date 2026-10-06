import { z } from "zod";
import { GOOGLE_SERVICES } from "../db/schema";
import type { GoogleService } from "../db/schema";
import type { Env } from "../env";

export class GoogleError extends Error {}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// What each connection asks the customer to agree to. Read-only: this app
// never writes to anyone's Google account.
const SCOPES: Record<GoogleService, string> = {
  search_console: "https://www.googleapis.com/auth/webmasters.readonly",
  // The Business Profile API has no read-only scope: reviews and replies
  // live in the old v4 endpoints, which only accept business.manage. This
  // app only ever reads with it.
  business_profile: "https://www.googleapis.com/auth/business.manage",
};

// The redirect URI Google sends the customer back to. It has to match one
// registered on the OAuth client exactly, so it is built from the app's own
// base URL rather than from the incoming request.
export function redirectUri(env: Env): string {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/google/callback`;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

// What the signed state carries: who started the flow, which service, and
// when the link stops working.
const stateBody = z.object({
  userId: z.string().min(1),
  service: z.enum(GOOGLE_SERVICES),
  expiresAt: z.number(),
});

// The state parameter carries who started the flow, signed so a callback
// cannot be forged or replayed with someone else's account id. Nothing is
// stored server-side.
export async function signState(env: Env, userId: string, service: GoogleService, ttlMs = STATE_TTL_MS): Promise<string> {
  const body = JSON.stringify({ userId, service, expiresAt: Date.now() + ttlMs });
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env.BETTER_AUTH_SECRET), new TextEncoder().encode(body));
  return `${bytesToBase64Url(new TextEncoder().encode(body))}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export type StateClaim = Pick<z.infer<typeof stateBody>, "userId" | "service">;

// Null for anything that is not a state this worker signed within the last
// ten minutes.
export async function readState(env: Env, state: string): Promise<StateClaim | null> {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const body = base64UrlToBytes(encoded);
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(env.BETTER_AUTH_SECRET), base64UrlToBytes(signature), body);
  if (!valid) return null;
  // A link made before this list of services changed, or more than ten
  // minutes ago, is no longer something to act on.
  const claim = stateBody.safeParse(JSON.parse(new TextDecoder().decode(body)));
  if (!claim.success || claim.data.expiresAt < Date.now()) return null;
  return { userId: claim.data.userId, service: claim.data.service };
}

export function authUrl(env: Env, service: GoogleService, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: `${SCOPES[service]} https://www.googleapis.com/auth/userinfo.email`,
    // offline plus consent is the only combination Google reliably returns a
    // refresh token for, including on a second connection.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64UrlToBytes(env.GOOGLE_TOKEN_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Refresh tokens are long-lived keys to a customer's Google account, so they
// are encrypted before they reach the database.
export async function encryptToken(env: Env, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), new TextEncoder().encode(token));
  const both = new Uint8Array(iv.length + sealed.byteLength);
  both.set(iv);
  both.set(new Uint8Array(sealed), iv.length);
  return bytesToBase64Url(both);
}

export async function decryptToken(env: Env, sealed: string): Promise<string> {
  const bytes = base64UrlToBytes(sealed);
  const plain = await crypto.subtle
    .decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, await tokenKey(env), bytes.subarray(12))
    .catch(() => {
      throw new GoogleError("stored Google token could not be read");
    });
  return new TextDecoder().decode(plain);
}

// Every call to Google goes through here, so a network failure reads the
// same wherever it happens.
async function ask(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init).catch((err: unknown) => {
    throw new GoogleError(`Google request failed: ${String(err)}`);
  });
}

async function postForm(url: string, form: Record<string, string>): Promise<Response> {
  return ask(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
}

export interface Granted {
  accessToken: string;
  refreshToken: string;
  account: string;
}

// Turns the one-time code from the callback into a refresh token and the
// email of the Google account that granted it.
export async function exchangeCode(env: Env, code: string): Promise<Granted> {
  const res = await postForm(TOKEN_URL, {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(env),
    grant_type: "authorization_code",
  });
  if (!res.ok) throw new GoogleError(`Google returned ${res.status} for the code exchange`);
  const body: TokenResponse = await res.json();
  if (!body.access_token || !body.refresh_token) throw new GoogleError("Google returned no refresh token");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, account: await accountEmail(body.access_token) };
}

async function accountEmail(token: string): Promise<string> {
  const res = await ask(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GoogleError(`Google returned ${res.status} for the account email`);
  const body: { email?: string } = await res.json();
  if (!body.email) throw new GoogleError("Google returned no account email");
  return body.email;
}

// Access tokens last about an hour and are never stored: each piece of work
// swaps the refresh token for a fresh one.
export async function accessToken(env: Env, refreshToken: string): Promise<string> {
  const res = await postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  if (!res.ok) throw new GoogleError(`Google returned ${res.status} refreshing the token`);
  const body: TokenResponse = await res.json();
  if (!body.access_token) throw new GoogleError("Google returned no access token");
  return body.access_token;
}

// Best effort: a token Google has already forgotten, or a network blip, must
// not stop the customer disconnecting.
export async function revoke(refreshToken: string): Promise<void> {
  await postForm(REVOKE_URL, { token: refreshToken }).catch(() => undefined);
}
