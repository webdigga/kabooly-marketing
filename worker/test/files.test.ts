import { beforeEach, describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, sniffRaster } from "../src/files";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, mockEmail, pngBytes, testEnv, uploadLogo, verifiedUser } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

describe("sniffRaster", () => {
  it("recognises PNG, JPEG and WebP by their bytes", () => {
    expect(sniffRaster(pngBytes())).toBe("image/png");
    expect(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    const webp = new TextEncoder().encode("RIFF____WEBPVP8 ");
    expect(sniffRaster(webp)).toBe("image/webp");
  });

  it("rejects anything else, including a RIFF file that is not WebP", () => {
    expect(sniffRaster(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(sniffRaster(new TextEncoder().encode("RIFF____WAVEfmt "))).toBeNull();
    expect(sniffRaster(new Uint8Array([]))).toBeNull();
  });
});

describe("logo upload", () => {
  it("stores a PNG under the account's prefix", async () => {
    const { cookie } = await verifiedUser();
    const res = await uploadLogo(cookie);
    expect(res.status).toBe(200);
    const body: { key: string; url: string } = await res.json();
    expect(body.key).toMatch(/^users\/[^/]+\/logos\/[\w-]+\.png$/);
    expect(body.url).toBe(`/api/files/${body.key}`);
    const stored = await testEnv.FILES.get(body.key);
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
  });

  it("refuses files that are not raster images", async () => {
    const { cookie } = await verifiedUser();
    const res = await uploadLogo(cookie, new TextEncoder().encode("<svg></svg>"));
    expect(res.status).toBe(415);
  });

  it("refuses files over 2 MB", async () => {
    const { cookie } = await verifiedUser();
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(pngBytes());
    const res = await uploadLogo(cookie, big);
    expect(res.status).toBe(413);
  });
});

describe("file serving", () => {
  it("serves the owner's file with safe headers", async () => {
    const { cookie } = await verifiedUser();
    const { url }: { url: string } = await (await uploadLogo(cookie)).json();
    const res = await apiFetch(cookie, url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pngBytes());
  });

  it("offers a download with a cleaned filename", async () => {
    const { cookie } = await verifiedUser();
    const { url }: { url: string } = await (await uploadLogo(cookie)).json();
    const res = await apiFetch(cookie, `${url}?download=my%20"logo".png`);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="mylogo.png"');
    const plain = await apiFetch(cookie, `${url}?download=%20`);
    expect(plain.headers.get("Content-Disposition")).toBeNull();
    await res.arrayBuffer();
    await plain.arrayBuffer();
  });

  it("never serves another account's file", async () => {
    const owner = await verifiedUser("owner");
    const other = await verifiedUser("other");
    const { url }: { url: string } = await (await uploadLogo(owner.cookie)).json();
    expect((await apiFetch(other.cookie, url)).status).toBe(404);
  });

  it("answers 404 for missing files and path tricks", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    const prefix = key.slice(0, key.indexOf("/logos/"));
    expect((await apiFetch(cookie, `/api/files/${prefix}/logos/missing.png`)).status).toBe(404);
    expect((await apiFetch(cookie, `/api/files/${prefix}/..%2F..%2Fx`)).status).toBe(404);
  });
});
