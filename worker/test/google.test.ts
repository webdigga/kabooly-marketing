import { beforeEach, describe, expect, it } from "vitest";
import type { GoogleService } from "../src/db/schema";
import { connectionToken } from "../src/google/store";
import { decryptToken, encryptToken, readState, signState, REVOKE_URL, TOKEN_URL, USERINFO_URL } from "../src/google/oauth";
import { mockClaude } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockEmail, testEnv, verifiedUser } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
});

const CONNECT = "/api/google/search_console/connect";
const CONNECTIONS = "/api/google/connections";

// Google's two calls on the way back: the code exchange and the account email.
function mockGoogleGrant(refresh: string | null = "refresh-token-1"): void {
  onFetch(TOKEN_URL, () =>
    Response.json(refresh ? { access_token: "access-1", refresh_token: refresh } : { access_token: "access-1" })
  );
  onFetch(USERINFO_URL, () => Response.json({ email: "david@kabooly.com" }));
  onFetch(REVOKE_URL, () => new Response("{}"));
}

interface ConnectionJson {
  service: string;
  account: string;
  connectedAt: string;
}

async function connections(cookie: string): Promise<ConnectionJson[]> {
  const body: { connections: ConnectionJson[] } = await (await apiFetch(cookie, CONNECTIONS)).json();
  return body.connections;
}

async function connect(cookie: string): Promise<Response> {
  const start = await apiFetch(cookie, CONNECT, { manualRedirect: true });
  const state = new URL(start.headers.get("Location") ?? "").searchParams.get("state");
  return apiFetch(cookie, `/api/google/callback?code=code-1&state=${state ?? ""}`, { manualRedirect: true });
}

describe("connecting Search Console", () => {
  it("sends the customer to Google asking only to read, then stores the connection", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    const start = await apiFetch(cookie, CONNECT, { manualRedirect: true });
    const sent = new URL(start.headers.get("Location") ?? "");
    expect(start.status).toBe(302);
    expect(sent.origin + sent.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(sent.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(sent.searchParams.get("access_type")).toBe("offline");
    expect(sent.searchParams.get("redirect_uri")).toBe("http://localhost/api/google/callback");

    const back = await apiFetch(cookie, `/api/google/callback?code=code-1&state=${sent.searchParams.get("state") ?? ""}`, { manualRedirect: true });
    expect(back.headers.get("Location")).toBe("/settings?google=connected");
    const list = await connections(cookie);
    expect(list).toMatchObject([{ service: "search_console", account: "david@kabooly.com" }]);
    // The refresh token never leaves the Worker.
    expect(JSON.stringify(list)).not.toContain("refresh-token-1");
  });

  it("swaps the refresh token for a fresh access token when work needs one", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    const [row] = await testEnv.DB.prepare("SELECT user_id FROM google_connections").all<{ user_id: string }>().then((r) => r.results);
    onFetch(TOKEN_URL, () => Response.json({ access_token: "access-2" }));
    expect(await connectionToken(testEnv, row?.user_id ?? "", "search_console")).toBe("access-2");
    expect(callsTo(TOKEN_URL).at(-1)?.body).toContain("grant_type=refresh_token");
  });

  it("has no token for an account that never connected", async () => {
    expect(await connectionToken(testEnv, "nobody", "search_console")).toBeNull();
  });

  it("gives up on work when Google will not refresh the token", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    const [row] = await testEnv.DB.prepare("SELECT user_id FROM google_connections").all<{ user_id: string }>().then((r) => r.results);
    const userId = row?.user_id ?? "";
    onFetch(TOKEN_URL, () => new Response("no", { status: 400 }));
    await expect(connectionToken(testEnv, userId, "search_console")).rejects.toThrow("Google returned 400");
    onFetch(TOKEN_URL, () => Response.json({}));
    await expect(connectionToken(testEnv, userId, "search_console")).rejects.toThrow("no access token");
  });

  it("reconnecting replaces the account rather than adding a second row", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    onFetch(USERINFO_URL, () => Response.json({ email: "someone-else@kabooly.com" }));
    await connect(cookie);
    const list = await connections(cookie);
    expect(list).toHaveLength(1);
    expect(list[0]?.account).toBe("someone-else@kabooly.com");
  });
});

describe("the callback", () => {
  it("says so when Google refuses, when the state is not ours, and when the exchange fails", async () => {
    const { cookie } = await verifiedUser();
    const refused = await apiFetch(cookie, "/api/google/callback?error=access_denied", { manualRedirect: true });
    expect(refused.headers.get("Location")).toBe("/settings?google=refused");
    const forged = await apiFetch(cookie, "/api/google/callback?code=c&state=not.ours", { manualRedirect: true });
    expect(forged.headers.get("Location")).toBe("/settings?google=expired");

    mockGoogleGrant(null);
    const failed = await connect(cookie);
    expect(failed.headers.get("Location")).toBe("/settings?google=failed");
    expect(await connections(cookie)).toEqual([]);
  });

  it("says so when Google will not exchange the code, name the account, or answer at all", async () => {
    const { cookie } = await verifiedUser();
    onFetch(TOKEN_URL, () => new Response("no", { status: 400 }));
    expect((await connect(cookie)).headers.get("Location")).toBe("/settings?google=failed");

    onFetch(TOKEN_URL, () => Response.json({ access_token: "access-1", refresh_token: "refresh-1" }));
    onFetch(USERINFO_URL, () => new Response("no", { status: 403 }));
    expect((await connect(cookie)).headers.get("Location")).toBe("/settings?google=failed");

    onFetch(USERINFO_URL, () => Response.json({}));
    expect((await connect(cookie)).headers.get("Location")).toBe("/settings?google=failed");

    onFetch(TOKEN_URL, () => {
      throw new Error("network down");
    });
    expect((await connect(cookie)).headers.get("Location")).toBe("/settings?google=failed");
    expect(await connections(cookie)).toEqual([]);
  });

  it("refuses a state signed for a different account", async () => {
    const { cookie } = await verifiedUser();
    const state = await signState(testEnv, "someone-else", "search_console");
    const res = await apiFetch(cookie, `/api/google/callback?code=c&state=${state}`, { manualRedirect: true });
    expect(res.headers.get("Location")).toBe("/settings?google=expired");
  });
});

describe("disconnecting", () => {
  it("tells Google to forget the token and clears the connection", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    const res = await apiFetch(cookie, "/api/google/search_console", { method: "DELETE" });
    expect(await res.json()).toEqual({ removed: true });
    expect(callsTo(REVOKE_URL)).toHaveLength(1);
    expect(await connections(cookie)).toEqual([]);
  });

  it("disconnects even when Google will not take the revoke", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    onFetch(REVOKE_URL, () => {
      throw new Error("network down");
    });
    expect(await (await apiFetch(cookie, "/api/google/search_console", { method: "DELETE" })).json()).toEqual({ removed: true });
    expect(await connections(cookie)).toEqual([]);
  });

  it("says nothing was removed when there was no connection", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/google/search_console", { method: "DELETE" });
    expect(await res.json()).toEqual({ removed: false });
  });

  it("still disconnects when the stored token cannot be read", async () => {
    const { cookie } = await verifiedUser();
    mockGoogleGrant();
    await connect(cookie);
    await testEnv.DB.prepare("UPDATE google_connections SET refresh_token = 'nonsense'").run();
    const res = await apiFetch(cookie, "/api/google/search_console", { method: "DELETE" });
    expect(await res.json()).toEqual({ removed: true });
    expect(await connections(cookie)).toEqual([]);
  });
});

describe("unknown services", () => {
  it("are not found, connecting or disconnecting", async () => {
    const { cookie } = await verifiedUser();
    expect((await apiFetch(cookie, "/api/google/business_profile/connect")).status).toBe(404);
    expect((await apiFetch(cookie, "/api/google/business_profile", { method: "DELETE" })).status).toBe(404);
  });
});

describe("token storage", () => {
  it("round-trips a token and refuses one it did not seal", async () => {
    const sealed = await encryptToken(testEnv, "refresh-token-1");
    expect(sealed).not.toContain("refresh-token-1");
    expect(await decryptToken(testEnv, sealed)).toBe("refresh-token-1");
    await expect(decryptToken(testEnv, "nonsense")).rejects.toThrow("could not be read");
  });

  it("refuses a state that has expired, lapsed or been tampered with", async () => {
    const state = await signState(testEnv, "u1", "search_console");
    expect(await readState(testEnv, state)).toMatchObject({ userId: "u1", service: "search_console" });
    expect(await readState(testEnv, "no-dot")).toBeNull();
    expect(await readState(testEnv, `${state.split(".")[0] ?? ""}.AAAA`)).toBeNull();
    // Ten minutes late, and a service this app no longer offers.
    expect(await readState(testEnv, await signState(testEnv, "u1", "search_console", -1))).toBeNull();
    expect(await readState(testEnv, await signState(testEnv, "u1", "retired" as GoogleService))).toBeNull();
  });
});
