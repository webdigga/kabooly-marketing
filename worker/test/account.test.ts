import { beforeEach, describe, expect, it } from "vitest";
import { mockClaude, mockGemini } from "./ai-mocks";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, mockEmail, testEnv, uploadLogo, verifiedUser, withProfile } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
  mockGemini();
});

async function keysUnder(prefix: string): Promise<string[]> {
  const listed = await testEnv.FILES.list({ prefix });
  return listed.objects.map((o) => o.key);
}

describe("deleting an account", () => {
  it("removes the account, its profile, adverts and every file it owns", async () => {
    const { cookie, email } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    await apiFetch(cookie, "/api/generations", {
      method: "POST",
      body: { topic: "Spring ovens", platforms: ["instagram"] },
    }).then((res) => res.text());
    const prefix = key.slice(0, key.indexOf("/logos/") + 1);
    expect((await keysUnder(prefix)).length).toBeGreaterThan(1);

    const res = await apiFetch(cookie, "/api/account", { method: "DELETE" });
    expect(res.status).toBe(200);

    expect(await keysUnder(prefix)).toEqual([]);
    expect((await apiFetch(cookie, "/api/profile")).status).toBe(401);
    const user = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM user WHERE email = ?1")
      .bind(email)
      .first<{ n: number }>();
    expect(user?.n).toBe(0);
    const adverts = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM adverts").first<{ n: number }>();
    expect(adverts?.n).toBe(0);
  });

  it("clears prefixes with more files than one listing returns", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    const prefix = key.slice(0, key.indexOf("/logos/") + 1);
    for (let i = 0; i < 101; i++) await testEnv.FILES.put(`${prefix}logos/bulk-${String(i)}.png`, "x");
    expect((await keysUnder(prefix)).length).toBeGreaterThan(100);

    await apiFetch(cookie, "/api/account", { method: "DELETE" });
    expect(await keysUnder(prefix)).toEqual([]);
  });

  it("leaves other accounts alone", async () => {
    const other = await verifiedUser("other");
    const { key }: { key: string } = await (await uploadLogo(other.cookie)).json();
    const { cookie } = await verifiedUser();
    await apiFetch(cookie, "/api/account", { method: "DELETE" });
    expect(await testEnv.FILES.head(key)).not.toBeNull();
    expect((await apiFetch(other.cookie, "/api/profile")).status).toBe(200);
  });

  it("needs a signed-in account", async () => {
    expect((await apiFetch("", "/api/account", { method: "DELETE" })).status).toBe(401);
  });
});
