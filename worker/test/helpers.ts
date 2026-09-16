import { env, SELF } from "cloudflare:test";
import { vi } from "vitest";

/*
 * SELF and env are deprecated in favour of the cloudflare:workers module, but
 * the replacement relies on Cloudflare.GlobalProps typing that stable
 * workers-types cannot express yet. Funnelled through here so the eventual
 * migration is a two-line change.
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated
const worker = SELF;
// eslint-disable-next-line @typescript-eslint/no-deprecated
export const testEnv = env;

export const PASSWORD = "a-strong-password-123";

// 16x9 solid blue PNG.
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGOQ9btBEmIY1TAoNAAAH8W1sR7x5IYAAAAASUVORK5CYII=";

export function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(PNG_BASE64), (ch) => ch.charCodeAt(0));
}

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(`http://localhost${path}`, init);
}

export function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return appFetch(path, {
    method: "POST",
    // Browsers send Origin on same-origin POSTs; better-auth checks it
    // whenever a session cookie is present.
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function apiFetch(
  cookie: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  return appFetch(path, {
    method: init?.method ?? "GET",
    headers: {
      Cookie: cookie,
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export interface SentEmail {
  from: { email: string; name: string };
  to: string;
  subject: string;
  text: string;
}

export const sentEmails: SentEmail[] = [];

// Stands in for Cloudflare Email Sending: records every message, or throws
// the way the binding does when sending fails.
export function mockEmail(options: { fail?: boolean } = {}): void {
  sentEmails.length = 0;
  vi.spyOn(testEnv.EMAIL, "send").mockImplementation((message) => {
    sentEmails.push(message as unknown as SentEmail);
    if (options.fail) return Promise.reject(Object.assign(new Error("rate limited"), { code: "E_RATE_LIMIT_EXCEEDED" }));
    return Promise.resolve({ messageId: `m-${String(sentEmails.length)}` });
  });
}

export function codesSentTo(email: string): SentEmail[] {
  return sentEmails.filter((m) => m.to === email);
}

export function lastCodeSentTo(email: string): string {
  const sent = sentEmails.filter((m) => m.to === email).at(-1);
  const code = /\b(\d{6})\b/.exec(sent?.text ?? "")?.[1];
  if (!code) throw new Error(`no code emailed to ${email}`);
  return code;
}

let userCounter = 0;

export function uniqueEmail(label = "user"): string {
  userCounter += 1;
  return `${label}${userCounter}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

export async function signUp(email: string): Promise<string> {
  const res = await postJson("/api/auth/sign-up/email", { name: "", email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`sign-up failed with ${res.status}: ${await res.text()}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("sign-up returned no session cookie");
  return cookie;
}

// A signed-in account with a verified email: what every app route needs.
// Requires mockEmail() to be installed.
export async function verifiedUser(label = "user"): Promise<{ cookie: string; email: string }> {
  const email = uniqueEmail(label);
  const cookie = await signUp(email);
  await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
  const res = await postJson("/api/auth/email-otp/verify-email", { email, otp: lastCodeSentTo(email) });
  if (res.status !== 200) throw new Error(`verify failed with ${res.status}`);
  return { cookie, email };
}

export const PROFILE = {
  businessName: "Acme Cleaning",
  description: "Domestic and end of tenancy cleaning",
  websiteUrl: "acme-cleaning.co.uk",
  targetAudience: "Busy families and landlords",
  localArea: "Twickenham",
  tone: 3,
  services: ["Oven cleaning", "Carpet cleaning"],
  brandColours: ["#1D4ED8"],
  logoKey: null,
};

export async function withProfile(
  cookie: string,
  overrides: Partial<typeof PROFILE> | Record<string, unknown> = {}
): Promise<Response> {
  return apiFetch(cookie, "/api/profile", { method: "PUT", body: { ...PROFILE, ...overrides } });
}

export async function uploadLogo(cookie: string, bytes: Uint8Array = pngBytes()): Promise<Response> {
  return appFetch("/api/uploads/logo", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/octet-stream" },
    body: bytes,
  });
}
