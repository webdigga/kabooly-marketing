import { beforeEach, describe, expect, it } from "vitest";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, appFetch, mockEmail, PROFILE, testEnv, uploadLogo, uploadStrip, verifiedUser, withProfile } from "./helpers";

interface ProfileJson {
  businessName: string;
  websiteUrl: string | null;
  services: string[];
  brandColours: string[];
  logoKey: string | null;
  logoUrl: string | null;
}

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

async function profileOf(cookie: string): Promise<ProfileJson | null> {
  const body: { profile: ProfileJson | null } = await (await apiFetch(cookie, "/api/profile")).json();
  return body.profile;
}

describe("business profile", () => {
  it("has no profile before onboarding", async () => {
    const { cookie } = await verifiedUser();
    expect(await profileOf(cookie)).toBeNull();
  });

  it("saves a profile with normalised website, lower-case colours and ordered services", async () => {
    const { cookie } = await verifiedUser();
    const res = await withProfile(cookie, { services: ["Oven cleaning", "oven cleaning", "Windows"] });
    expect(res.status).toBe(200);
    const profile = await profileOf(cookie);
    expect(profile).toMatchObject({
      businessName: "Acme Cleaning",
      websiteUrl: "https://acme-cleaning.co.uk/",
      services: ["Oven cleaning", "Windows"],
      brandColours: ["#1d4ed8"],
      logoKey: null,
      logoUrl: null,
    });
  });

  it("replaces the services list and allows no website on update", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    await withProfile(cookie, { services: ["Gutters"], websiteUrl: null, businessName: "Acme Ltd" });
    expect(await profileOf(cookie)).toMatchObject({
      businessName: "Acme Ltd",
      websiteUrl: null,
      services: ["Gutters"],
    });
  });

  it.each([
    [{ businessName: "" }, "businessName"],
    [{ tone: 6 }, "tone"],
    [{ services: [] }, "services"],
    [{ brandColours: ["blue"] }, "brandColours.0"],
    [{ websiteUrl: "not a site" }, "websiteUrl"],
    [{ logoKey: "users/someone-else/logos/x.png" }, "logoKey"],
  ])("rejects %o", async (override, field) => {
    const { cookie } = await verifiedUser();
    const res = await withProfile(cookie, override);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request", field });
  });

  it("rejects a body that is not JSON", async () => {
    const { cookie } = await verifiedUser();
    const res = await appFetch("/api/profile", {
      method: "PUT",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("keeps a brand strip the account uploaded and rejects one it did not", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadStrip(cookie)).json();
    expect((await withProfile(cookie, { brandStripKey: key })).status).toBe(200);
    const stored = await testEnv.DB.prepare("SELECT brand_strip_key AS k FROM business_profiles WHERE brand_strip_key = ?1")
      .bind(key)
      .first<{ k: string }>();
    expect(stored?.k).toBe(key);
    const bad = await withProfile(cookie, { brandStripKey: "users/someone/brand/x.png" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "brandStripKey" });
  });

  it("rejects a logo key that was never uploaded", async () => {
    const { cookie } = await verifiedUser();
    const upload: { key: string } = await (await uploadLogo(cookie)).json();
    const res = await withProfile(cookie, { logoKey: upload.key.replace(/[^/]+$/, "missing.png") });
    expect(res.status).toBe(400);
  });

  it("clears logo files the account never kept when the profile is saved", async () => {
    const { cookie } = await verifiedUser();
    const abandoned: { key: string } = await (await uploadLogo(cookie)).json();
    const chosen: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: chosen.key });
    expect(await testEnv.FILES.head(abandoned.key)).toBeNull();
    expect(await testEnv.FILES.head(chosen.key)).not.toBeNull();
  });

  it("keeps the logo, and deletes the old file when it is replaced or removed", async () => {
    const { cookie } = await verifiedUser();
    const first: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: first.key });
    expect(await profileOf(cookie)).toMatchObject({ logoKey: first.key, logoUrl: `/api/files/${first.key}` });

    await withProfile(cookie, { logoKey: first.key });
    expect(await testEnv.FILES.head(first.key)).not.toBeNull();

    const second: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: second.key });
    expect(await testEnv.FILES.head(first.key)).toBeNull();

    await withProfile(cookie, { logoKey: null });
    expect(await testEnv.FILES.head(second.key)).toBeNull();
    expect(await profileOf(cookie)).toMatchObject({ logoKey: null });
  });

  it("stores the profile fields the generator reads", async () => {
    const { cookie } = await verifiedUser();
    await withProfile(cookie);
    const body: { profile: Record<string, unknown> } = await (await apiFetch(cookie, "/api/profile")).json();
    expect(body.profile).toMatchObject({
      description: PROFILE.description,
      targetAudience: PROFILE.targetAudience,
      localArea: PROFILE.localArea,
      tone: PROFILE.tone,
    });
  });
});
