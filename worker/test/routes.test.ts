import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, appFetch, mockEmail, testEnv, uploadLogo, verifiedUser } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

describe("routes", () => {
  it("reports health", async () => {
    const res = await appFetch("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers paths outside the API with a JSON 404", async () => {
    const res = await appFetch("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("answers unknown API paths with a JSON 404 once signed in", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("answers an unexpected failure with a JSON 500", async () => {
    const { cookie } = await verifiedUser();
    const { url }: { url: string } = await (await uploadLogo(cookie)).json();
    const spy = vi.spyOn(testEnv.FILES, "get").mockRejectedValueOnce(new Error("R2 down"));
    const res = await apiFetch(cookie, url);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
  });
});
