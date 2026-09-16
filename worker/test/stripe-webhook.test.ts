import { beforeEach, describe, expect, it, vi } from "vitest";
import * as billing from "../src/billing";
import { verifyStripeSignature } from "../src/stripe-signature";
import { installFetchMock } from "./fetch-mock";
import { appFetch, apiFetch, mockEmail, testEnv, verifiedUser } from "./helpers";

const SECRET = "whsec_test_marketing";

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

async function sign(payload: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${String(timestamp)}.${payload}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${String(timestamp)},v1=${hex}`;
}

function event(type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`): string {
  return JSON.stringify({ id, type, data: { object } });
}

async function deliver(payload: string, signature?: string): Promise<Response> {
  return appFetch("/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "Stripe-Signature": signature } : {}) },
    body: payload,
  });
}

describe("Stripe webhook", () => {
  it("rejects missing, stale, malformed and wrong signatures", async () => {
    const payload = event("customer.subscription.updated", {});
    expect((await deliver(payload)).status).toBe(400);
    expect((await deliver(payload, await sign(payload, Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect((await deliver(payload, "t=abc,v1=zz")).status).toBe(400);
    expect((await deliver(payload, await sign(payload, undefined, "whsec_other"))).status).toBe(400);
  });

  it("rejects a correctly signed body that is not a Stripe event", async () => {
    for (const payload of ["not json", JSON.stringify({ id: "evt" })]) {
      expect((await deliver(payload, await sign(payload))).status).toBe(400);
    }
  });

  it("switches a standalone Marketing account off when its subscription lapses, then back on", async () => {
    const { cookie, subscriptionId } = await verifiedUser("standalone");
    const lapsed = event("customer.subscription.updated", { id: subscriptionId, status: "past_due", metadata: { plan: "marketing" } });
    expect((await deliver(lapsed, await sign(lapsed))).status).toBe(200);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(402);

    const paid = event("customer.subscription.updated", { id: subscriptionId, status: "active", metadata: { plan: "marketing" } });
    await deliver(paid, await sign(paid));
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
  });

  it("switches access off when the subscription is deleted", async () => {
    const { cookie, subscriptionId } = await verifiedUser("deleted");
    const payload = event("customer.subscription.deleted", { id: subscriptionId, status: "active", metadata: { plan: "marketing" } });
    await deliver(payload, await sign(payload));
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(402);
    const row = await testEnv.DB.prepare("SELECT status FROM subscriptions WHERE stripe_subscription_id = ?1").bind(subscriptionId).first();
    expect(row).toEqual({ status: "canceled" });
  });

  it("ignores bundle, CRM and unlabelled subscriptions, other event types, and events without an id or status", async () => {
    const { cookie, subscriptionId } = await verifiedUser("ignored", { source: "bundle" });
    const payloads = [
      event("customer.subscription.updated", { id: subscriptionId, status: "canceled", metadata: { plan: "bundle" } }),
      event("customer.subscription.updated", { id: subscriptionId, status: "canceled", metadata: { plan: "crm" } }),
      event("customer.subscription.deleted", { id: subscriptionId, status: "canceled", metadata: null }),
      event("invoice.payment_failed", { id: "in_1", subscription: subscriptionId }),
      event("customer.subscription.updated", { status: "canceled", metadata: { plan: "marketing" } }),
    ];
    for (const payload of payloads) expect((await deliver(payload, await sign(payload))).status).toBe(200);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(200);
  });

  it("records a missing status as unknown, which does not grant access", async () => {
    const { cookie, subscriptionId } = await verifiedUser("nostatus");
    const payload = event("customer.subscription.updated", { id: subscriptionId, metadata: { plan: "marketing" } });
    await deliver(payload, await sign(payload));
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(402);
  });

  it("handles a redelivered event once", async () => {
    const { subscriptionId } = await verifiedUser("dupe");
    const payload = event("customer.subscription.updated", { id: subscriptionId, status: "active", metadata: { plan: "marketing" } }, "evt_dupe_1");
    expect(await (await deliver(payload, await sign(payload))).json()).toEqual({ received: true });
    expect(await (await deliver(payload, await sign(payload))).json()).toEqual({ received: true, duplicate: true });
  });

  it("returns 500 and releases the event for Stripe to retry when the update fails", async () => {
    const { subscriptionId } = await verifiedUser("retry");
    const spy = vi.spyOn(billing, "setSubscriptionState").mockRejectedValueOnce(new Error("D1 down"));
    const payload = event("customer.subscription.updated", { id: subscriptionId, status: "active", metadata: { plan: "marketing" } }, "evt_retry_1");
    expect((await deliver(payload, await sign(payload))).status).toBe(500);
    spy.mockRestore();
    expect(await (await deliver(payload, await sign(payload))).json()).toEqual({ received: true });
  });
});

describe("verifyStripeSignature", () => {
  it("accepts any matching v1 signature and rejects odd-length or non-hex ones", async () => {
    const now = 1_800_000_000;
    const good = await sign("body", now);
    const v1 = good.split("v1=")[1] ?? "";
    expect(await verifyStripeSignature("body", `t=${String(now)},v1=abc,v1=${v1}`, SECRET, now)).toBe(true);
    expect(await verifyStripeSignature("body", `t=${String(now)},v1=abcd`, SECRET, now)).toBe(false);
    expect(await verifyStripeSignature("body", `t=${String(now)}`, SECRET, now)).toBe(false);
    expect(await verifyStripeSignature("body", `v1=${v1}`, SECRET, now)).toBe(false);
  });
});
