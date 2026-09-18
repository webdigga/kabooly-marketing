import { beforeEach, describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, MAX_PHOTO_BYTES, MAX_STRIP_BYTES, sniffRaster } from "../src/files";
import { installFetchMock } from "./fetch-mock";
import { apiFetch, appFetch, mockEmail, photoBytes, pngBytes, testEnv, uploadLogo, uploadPhoto, uploadStrip, verifiedUser } from "./helpers";

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

  it("serves byte ranges, so videos play on iPhones", async () => {
    const { cookie } = await verifiedUser();
    const { url }: { url: string } = await (await uploadLogo(cookie)).json();
    const whole = pngBytes();
    const get = (range: string) => appFetch(url, { headers: { Cookie: cookie, Range: range } });

    const first = await get("bytes=0-3");
    expect(first.status).toBe(206);
    expect(first.headers.get("Content-Range")).toBe(`bytes 0-3/${whole.length}`);
    expect(first.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(whole.subarray(0, 4));

    const rest = await get("bytes=10-");
    expect(rest.headers.get("Content-Range")).toBe(`bytes 10-${whole.length - 1}/${whole.length}`);
    expect(new Uint8Array(await rest.arrayBuffer())).toEqual(whole.subarray(10));

    const tail = await get("bytes=-5");
    expect(tail.headers.get("Content-Range")).toBe(`bytes ${whole.length - 5}-${whole.length - 1}/${whole.length}`);
    await tail.arrayBuffer();

    const beyond = await get("bytes=9999-");
    expect(beyond.status).toBe(200);
    expect(new Uint8Array(await beyond.arrayBuffer())).toEqual(whole);
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

describe("brand strip upload", () => {
  it("stores the strip the browser drew", async () => {
    const { cookie } = await verifiedUser();
    const res = await uploadStrip(cookie);
    expect(res.status).toBe(200);
    const body: { key: string; url: string } = await res.json();
    expect(body.key).toMatch(/^users\/[^/]+\/brand\/[\w-]+\.png$/);
    expect(await testEnv.FILES.head(body.key)).not.toBeNull();
  });

  it("refuses anything that is not a PNG, or is too large", async () => {
    const { cookie } = await verifiedUser();
    const jpeg = await uploadStrip(cookie, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    expect(jpeg.status).toBe(415);
    const huge = await uploadStrip(cookie, new Uint8Array(MAX_STRIP_BYTES + 1));
    expect(huge.status).toBe(413);
  });
});

describe("photo upload", () => {
  it("keeps one photo per account, with its size", async () => {
    const { cookie } = await verifiedUser();
    const first: { key: string } = await (await uploadPhoto(cookie, await photoBytes())).json();
    const res = await uploadPhoto(cookie, await photoBytes(1200, 1500));
    expect(res.status).toBe(200);
    const body: { key: string; url: string; width: number; height: number } = await res.json();
    expect(body).toMatchObject({ width: 1200, height: 1500, url: `/api/files/${body.key}` });
    expect(body.key).toMatch(/^users\/[^/]+\/uploads\/[\w-]+\.jpg$/);
    expect(await testEnv.FILES.head(first.key)).toBeNull();
    expect(await testEnv.FILES.head(body.key)).not.toBeNull();
  });

  it.each([
    ["too small", () => photoBytes(1600, 1000), 422, "photo_too_small"],
    ["not an image", () => Promise.resolve(new TextEncoder().encode("hello")), 415, "photo_type"],
    ["unreadable", () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01])), 415, "photo_type"],
    ["too large", () => Promise.resolve(new Uint8Array(MAX_PHOTO_BYTES + 1)), 413, "photo_too_large"],
  ])("refuses a photo that is %s", async (_label, bytes, status, code) => {
    const { cookie } = await verifiedUser();
    const res = await uploadPhoto(cookie, await bytes());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });
});
