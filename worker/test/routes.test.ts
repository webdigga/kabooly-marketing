import { describe, expect, it } from "vitest";
import { appFetch } from "./helpers";

describe("routes", () => {
  it("reports health", async () => {
    const res = await appFetch("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await appFetch("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
