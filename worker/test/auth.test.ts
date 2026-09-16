import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock } from "./fetch-mock";
import {
  apiFetch,
  appFetch,
  lastCodeSentTo,
  mockEmail,
  PASSWORD,
  codesSentTo,
  postJson,
  sentEmails,
  testEnv,
  uniqueEmail,
  verifiedUser,
} from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

async function signIn(email: string, password = PASSWORD): Promise<Response> {
  return postJson("/api/auth/sign-in/email", { email, password });
}

async function unverifiedUser(): Promise<{ email: string; cookie: string }> {
  const { email, cookie } = await verifiedUser("unverified");
  await testEnv.DB.prepare("UPDATE user SET email_verified = 0 WHERE email = ?1").bind(email).run();
  return { email, cookie };
}

describe("registration is closed", () => {
  it("refuses email and password sign-up", async () => {
    const email = uniqueEmail("walkin");
    const res = await postJson("/api/auth/sign-up/email", { name: "", email, password: PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1").bind(email).first();
    expect(row).toBeNull();
  });

  it("refuses to create an account from a sign-in code", async () => {
    const email = uniqueEmail("otp");
    await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
    const res = await postJson("/api/auth/sign-in/email-otp", { email, otp: "123456" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(codesSentTo(email)).toHaveLength(0);
    const row = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1").bind(email).first();
    expect(row).toBeNull();
  });
});

describe("verification", () => {
  it("lets a provisioned account straight in: the payment proved the email", async () => {
    const { cookie, email } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/profile");
    expect(res.status).toBe(200);
    const login: { user: { emailVerified: boolean } } = await (await signIn(email)).json();
    expect(login.user.emailVerified).toBe(true);
  });

  it("keeps unverified accounts out of the app", async () => {
    const { cookie } = await unverifiedUser();
    const res = await apiFetch(cookie, "/api/profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Email not verified" });
  });

  it("refuses the app without a session", async () => {
    const res = await apiFetch("", "/api/profile");
    expect(res.status).toBe(401);
  });

  it("verifies an email with the emailed code", async () => {
    const { cookie, email } = await unverifiedUser();
    await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
    expect(sentEmails.at(-1)).toMatchObject({
      from: { email: "test@example.com", name: "Kabooly Marketing" },
      to: email,
      subject: "Your Kabooly Marketing verification code",
    });
    const res = await postJson("/api/auth/email-otp/verify-email", { email, otp: lastCodeSentTo(email) });
    expect(res.status).toBe(200);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
  });

  it("rejects a wrong verification code", async () => {
    const { email } = await unverifiedUser();
    await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
    const res = await postJson("/api/auth/email-otp/verify-email", { email, otp: "000000" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // better-auth awaits the send but swallows (and logs) a failure, so the
  // response does not reveal whether an address can receive mail.
  it("attempts the send even when the mail provider fails", async () => {
    const { email } = await unverifiedUser();
    mockEmail({ fail: true });
    const res = await postJson("/api/auth/email-otp/send-verification-otp", { email, type: "email-verification" });
    expect(res.status).toBe(200);
    expect(codesSentTo(email)).toHaveLength(1);
  });
});

describe("password reset", () => {
  it("resets a password with the emailed code", async () => {
    const { email } = await verifiedUser();
    const req = await postJson("/api/auth/email-otp/request-password-reset", { email });
    expect(req.status).toBe(200);
    expect(sentEmails.at(-1)?.subject).toBe("Your Kabooly Marketing password reset code");

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
