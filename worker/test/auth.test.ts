import { beforeEach, describe, expect, it } from "vitest";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import {
  apiFetch,
  appFetch,
  lastCodeSentTo,
  mockResend,
  PASSWORD,
  postJson,
  RESEND_URL,
  signUp,
  testEnv,
  uniqueEmail,
  verifiedUser,
} from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockResend();
});

async function signIn(email: string, password = PASSWORD): Promise<Response> {
  return postJson("/api/auth/sign-in/email", { email, password });
}

describe("registration and verification", () => {
  it("signs up with email and password only", async () => {
    const cookie = await signUp(uniqueEmail());
    expect(cookie).toContain("better-auth");
  });

  it("keeps unverified accounts out of the app", async () => {
    const cookie = await signUp(uniqueEmail());
    const res = await apiFetch(cookie, "/api/profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Email not verified" });
  });

  it("refuses the app without a session", async () => {
    const res = await apiFetch("", "/api/profile");
    expect(res.status).toBe(401);
  });

  it("verifies an email with the emailed code and then lets the account in", async () => {
    const { cookie, email } = await verifiedUser();
    const sent = callsTo(RESEND_URL).map((c) => JSON.parse(c.body) as { subject: string; to: string[] });
    expect(sent.at(-1)).toMatchObject({ to: [email], subject: "Your Kabooly Marketing verification code" });
    const res = await apiFetch(cookie, "/api/profile");
    expect(res.status).toBe(200);
    const login: { user: { emailVerified: boolean } } = await (await signIn(email)).json();
    expect(login.user.emailVerified).toBe(true);
  });

  it("rejects a wrong verification code", async () => {
    const email = uniqueEmail();
    await signUp(email);
    await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
    const res = await postJson("/api/auth/email-otp/verify-email", { email, otp: "000000" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("sends nothing for the unused sign-in code type", async () => {
    const email = uniqueEmail();
    await signUp(email);
    const res = await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
    expect(res.status).toBe(200);
    expect(callsTo(RESEND_URL)).toHaveLength(0);
  });

  // better-auth awaits the send but swallows (and logs) a failure, so the
  // response does not reveal whether an address can receive mail.
  it("attempts the send even when the mail provider fails", async () => {
    onFetch(RESEND_URL, () => new Response("down", { status: 500 }));
    const email = uniqueEmail();
    await signUp(email);
    const res = await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
    expect(res.status).toBe(200);
    expect(callsTo(RESEND_URL)).toHaveLength(1);
  });
});

describe("password reset", () => {
  it("resets a password with the emailed code", async () => {
    const { email } = await verifiedUser();
    const req = await postJson("/api/auth/email-otp/request-password-reset", { email });
    expect(req.status).toBe(200);
    const sent = callsTo(RESEND_URL).map((c) => JSON.parse(c.body) as { subject: string });
    expect(sent.at(-1)?.subject).toBe("Your Kabooly Marketing password reset code");

    const reset = await postJson("/api/auth/email-otp/reset-password", {
      email,
      otp: lastCodeSentTo(email),
      password: "a-brand-new-password-1",
    });
    expect(reset.status).toBe(200);
    expect((await signIn(email)).status).toBeGreaterThanOrEqual(400);
    expect((await signIn(email, "a-brand-new-password-1")).status).toBe(200);
  });
});

describe("sessions", () => {
  it("signs out and the session stops working", async () => {
    const { cookie } = await verifiedUser();
    const out = await postJson("/api/auth/sign-out", {}, cookie);
    expect(out.status).toBe(200);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(401);
  });
});

describe("Google sign-in", () => {
  it("starts with a Google authorization URL for this app's client", async () => {
    const res = await appFetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });
    expect(res.status).toBe(200);
    const body: { url: string } = await res.json();
    expect(body.url).toContain("accounts.google.com");
    expect(body.url).toContain(testEnv.GOOGLE_CLIENT_ID);
  });
});
