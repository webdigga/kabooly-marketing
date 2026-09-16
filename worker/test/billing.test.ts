import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock } from "./fetch-mock";
import {
  apiFetch,
  INTERNAL_SECRET,
  internalPost,
  mockEmail,
  PASSWORD,
  postJson,
  provision,
  sentEmails,
  setPasswordTokenSentTo,
  signInCookie,
  testEnv,
  uniqueEmail,
  verifiedUser,
} from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

async function subscriptionRow(email: string): Promise<Record<string, unknown> | null> {
  return testEnv.DB.prepare(
    "SELECT s.* FROM subscriptions s JOIN user u ON u.id = s.user_id WHERE u.email = ?1"
  )
    .bind(email)
    .first();
}

describe("internal API auth", () => {
  it("refuses requests without the shared secret", async () => {
    expect((await internalPost("/api/internal/provision/check", { email: "a@b.com" }, null)).status).toBe(401);
  });

  it("refuses a wrong secret of the same length and of a different length", async () => {
    const wrong = "x".repeat(INTERNAL_SECRET.length);
    expect((await internalPost("/api/internal/provision/check", { email: "a@b.com" }, wrong)).status).toBe(401);
    expect((await internalPost("/api/internal/provision/check", { email: "a@b.com" }, "short")).status).toBe(401);
  });
});

describe("POST /api/internal/provision", () => {
  it("creates a verified account with an active subscription and emails a 7 day set-password link", async () => {
    const email = uniqueEmail("buyer");
    await provision(email.toUpperCase(), { subscriptionId: "sub_new_1" });

    const row = await subscriptionRow(email);
    expect(row).toMatchObject({
      source: "marketing",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_new_1",
      status: "active",
      active: 1,
    });

    const user = await testEnv.DB.prepare("SELECT email_verified FROM user WHERE email = ?1").bind(email).first();
    expect(user).toEqual({ email_verified: 1 });

    const mail = sentEmails.at(-1);
    expect(mail).toMatchObject({ to: email, subject: "Choose your Kabooly Marketing password" });
    expect(mail?.text).toContain("Hi Test Customer,");
    expect(mail?.text).toContain("http://localhost/set-password?token=");
    expect(mail?.text).not.toContain("CRM");

    const token = setPasswordTokenSentTo(email);
    const verification = await testEnv.DB.prepare("SELECT expires_at FROM verification WHERE identifier = ?1")
      .bind(`reset-password:${token}`)
      .first<{ expires_at: number }>();
    const days = ((verification?.expires_at ?? 0) * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("lets the customer choose a password from the link and sign in, with no password ever sent to provisioning", async () => {
    const email = uniqueEmail("chooser");
    await provision(email);
    const set = await postJson("/api/auth/reset-password", { token: setPasswordTokenSentTo(email), newPassword: PASSWORD });
    expect(set.status).toBe(200);
    const cookie = await signInCookie(email);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
    // The link is single use.
    const again = await postJson("/api/auth/reset-password", { token: setPasswordTokenSentTo(email), newPassword: "another-password-9" });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("mentions the separate CRM login for bundle customers and greets nameless customers plainly", async () => {
    const email = uniqueEmail("bundle");
    const res = await internalPost("/api/internal/provision", {
      email,
      name: "",
      source: "bundle",
      stripeCustomerId: "cus_b",
      stripeSubscriptionId: "sub_bundle_1",
      status: "active",
    });
    expect(res.status).toBe(201);
    const text = sentEmails.at(-1)?.text ?? "";
    expect(text.startsWith("Hi,")).toBe(true);
    expect(text).toContain("Your Kabooly CRM login arrives in a separate email.");
    expect(await subscriptionRow(email)).toMatchObject({ source: "bundle", active: 1 });
  });

  it("is idempotent on the subscription id", async () => {
    const email = uniqueEmail("retry");
    await provision(email, { subscriptionId: "sub_retry_1" });
    const again = await internalPost("/api/internal/provision", {
      email,
      name: "Test Customer",
      source: "marketing",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_retry_1",
      status: "active",
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "exists" });
    const count = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM user WHERE email = ?1").bind(email).first();
    expect(count).toEqual({ n: 1 });
  });

  it("refuses an email that already has an account", async () => {
    const email = uniqueEmail("dupe");
    await provision(email);
    const res = await internalPost("/api/internal/provision", {
      email,
      name: "",
      source: "marketing",
      stripeCustomerId: "cus_x",
      stripeSubscriptionId: "sub_other",
      status: "active",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email_exists" });
  });

  it("rejects invalid bodies", async () => {
    expect((await internalPost("/api/internal/provision", { email: "nope" })).status).toBe(400);
    expect((await internalPost("/api/internal/provision", "{")).status).toBe(400);
  });

  it("still creates the account and reports emailSent=false when the email fails", async () => {
    mockEmail({ fail: true });
    const email = uniqueEmail("nomail");
    const res = await internalPost("/api/internal/provision", {
      email,
      name: "Test",
      source: "marketing",
      stripeCustomerId: "cus_n",
      stripeSubscriptionId: "sub_nomail",
      status: "active",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "created", emailSent: false });
  });

  it("creates an inactive account when checkout reports a non-paying status", async () => {
    const email = uniqueEmail("incomplete");
    await provision(email, { status: "incomplete" });
    expect(await subscriptionRow(email)).toMatchObject({ status: "incomplete", active: 0 });
  });
});

describe("POST /api/internal/provision/check", () => {
  it("reports whether an email already has an account", async () => {
    const email = uniqueEmail("check");
    expect(await (await internalPost("/api/internal/provision/check", { email })).json()).toEqual({ exists: false });
    await provision(email);
    expect(await (await internalPost("/api/internal/provision/check", { email: email.toUpperCase() })).json()).toEqual({
      exists: true,
    });
  });

  it("rejects an invalid email", async () => {
    expect((await internalPost("/api/internal/provision/check", { email: "x" })).status).toBe(400);
  });
});

describe("access gate", () => {
  it("returns 402 once the subscription stops granting access, and 200 again when it resumes", async () => {
    const { cookie, subscriptionId } = await verifiedUser("gate", { source: "bundle" });
    const off = await internalPost("/api/internal/bundle-access", { stripeSubscriptionId: subscriptionId, active: false });
    expect(await off.json()).toEqual({ updated: true });

    const blocked = await apiFetch(cookie, "/api/profile");
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toEqual({ error: "Subscription inactive", code: "SUBSCRIPTION_INACTIVE" });

    await internalPost("/api/internal/bundle-access", { stripeSubscriptionId: subscriptionId, active: true });
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
  });

  it("lets the founder in without a subscription", async () => {
    const email = uniqueEmail("founder-check");
    await provision(email);
    await testEnv.DB.prepare("DELETE FROM subscriptions WHERE user_id = (SELECT id FROM user WHERE email = ?1)")
      .bind(email)
      .run();
    await testEnv.DB.prepare("UPDATE user SET email = 'founder@example.com' WHERE email = ?1").bind(email).run();
    const set = await postJson("/api/auth/reset-password", { token: setPasswordTokenSentTo(email), newPassword: PASSWORD });
    expect(set.status).toBe(200);
    const cookie = await signInCookie("founder@example.com");
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
    await testEnv.DB.prepare("DELETE FROM user WHERE email = 'founder@example.com'").run();
  });

  it("keeps accounts with no subscription row out", async () => {
    const { cookie, email } = await verifiedUser("norow");
    await testEnv.DB.prepare("DELETE FROM subscriptions WHERE user_id = (SELECT id FROM user WHERE email = ?1)")
      .bind(email)
      .run();
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(402);
  });
});

describe("POST /api/internal/bundle-access", () => {
  it("reports updated=false for an unknown subscription and rejects bad bodies", async () => {
    expect(await (await internalPost("/api/internal/bundle-access", { stripeSubscriptionId: "sub_none", active: false })).json()).toEqual({
      updated: false,
    });
    expect((await internalPost("/api/internal/bundle-access", { stripeSubscriptionId: "sub_none" })).status).toBe(400);
  });
});
