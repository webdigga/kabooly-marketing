import { beforeEach, describe, expect, it } from "vitest";
import { scanWebsite } from "../src/scan";
import { detectBrandColours, parseColour, toHex } from "../src/scan/colours";
import { decodeText, fetchLimited } from "../src/scan/fetch-limited";
import { fetchFirstLogo, rankLogoCandidates } from "../src/scan/logo";
import { findInfoPages } from "../src/scan/info-pages";
import { extractPageFacts } from "../src/scan/page";
import { normaliseWebsiteUrl, resolveUrl } from "../src/scan/url";
import { ANTHROPIC_URL, DETAILS, mockClaude } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockEmail, pngBytes, testEnv, verifiedUser } from "./helpers";

const SITE = "https://acme.example.co.uk";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

beforeEach(() => {
  installFetchMock();
  mockEmail();
});

function html(body: string, head = ""): Response {
  return new Response(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`, {
    headers: { "Content-Type": "text/html" },
  });
}

function png(): Response {
  return new Response(pngBytes(), { headers: { "Content-Type": "image/png" } });
}

describe("normaliseWebsiteUrl", () => {
  it.each([
    ["acme.co.uk", "https://acme.co.uk/"],
    ["  www.acme.co.uk/about#team ", "https://www.acme.co.uk/about"],
    ["http://acme.co.uk", "http://acme.co.uk/"],
  ])("accepts %s", (input, expected) => {
    expect(normaliseWebsiteUrl(input)?.toString()).toBe(expected);
  });

  it.each([
    "",
    "ftp://acme.co.uk",
    "localhost",
    "http://127.0.0.1",
    "http://[::1]/",
    "printer.local",
    "dev.localhost",
    "https://user:pass@acme.co.uk",
    "https://exa mple.com",
  ])("rejects %s", (input) => {
    expect(normaliseWebsiteUrl(input)).toBeNull();
  });
});

describe("resolveUrl", () => {
  it("resolves relative links and drops data and non-web URLs", () => {
    expect(resolveUrl("/logo.png", `${SITE}/about/`)).toBe(`${SITE}/logo.png`);
    expect(resolveUrl("data:image/png;base64,AAA", SITE)).toBeNull();
    expect(resolveUrl("javascript:alert(1)", SITE)).toBeNull();
    expect(resolveUrl("http://[bad", SITE)).toBeNull();
  });
});

describe("colours", () => {
  it("parses hex, rgb and hsl forms", () => {
    expect(parseColour("#1D4ED8")).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseColour("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColour("#f00c")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColour("#ff000010")).toBeNull();
    expect(parseColour("rgb(29, 78, 216)")).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseColour("rgb(100% 0% 0% / 80%)")).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColour("rgba(0, 0, 255, .2)")).toBeNull();
    expect(parseColour("rgb(1, 2)")).toBeNull();
    expect(parseColour("rgb(a, b, c)")).toBeNull();
    expect(parseColour("rgb(300, -4, 10)")).toEqual({ r: 255, g: 0, b: 10 });
    expect(toHex(parseColour("hsl(0, 100%, 50%)") ?? { r: 0, g: 0, b: 0 })).toBe("#ff0000");
    expect(toHex(parseColour("hsl(-120deg 100% 50%)") ?? { r: 0, g: 0, b: 0 })).toBe("#0000ff");
    expect(parseColour("hsla(0, 100%, 50%, 0.1)")).toBeNull();
    expect(parseColour("hsl(0, 100%)")).toBeNull();
    expect(parseColour("hsl(x, y%, z%)")).toBeNull();
  });

  it("ranks brand colours by where they appear and ignores greys", () => {
    const css = [
      ":root{--brand-primary:#1d4ed8;--text:#333333}",
      "a{color:#1e4fd9}.btn{background-color:#f59e0b}",
      "p{margin:0;color:#ffffff}.x{border:1px solid #000}",
      "h1{font-weight:bold}.y{outline-color:#10b981}.z{box-shadow:0 0 1px rgba(0,0,0,.1)}",
    ];
    expect(detectBrandColours(css, ["#e11d48"])).toEqual(["#e11d48", "#1d4ed8", "#f59e0b", "#10b981"]);
  });

  it("returns at most four colours and nothing for a grey site", () => {
    const many = ["a{color:#ff0000}", "b{color:#00ff00}", "c{color:#0000ff}", "d{color:#ffff00}", "e{color:#ff00ff}"];
    expect(detectBrandColours(many, [])).toHaveLength(4);
    expect(detectBrandColours(["body{color:#222;background:#fafafa}"], ["not a colour"])).toEqual([]);
  });
});

describe("page facts", () => {
  it("collects colours, css, icons and logo context in one pass", async () => {
    const facts = await extractPageFacts(`
      <html><head>
        <base href="/site/"><base href="/ignored/">
        <meta name="theme-color" content="#1d4ed8"><meta name="theme-color">
        <link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">
        <link rel="stylesheet" href="/c.css"><link rel="stylesheet" href="/d.css">
        <link rel="icon" href="/favicon.png" sizes="32x32"><link rel="mask-icon" href="/mask.svg">
        <link rel="apple-touch-icon" href="/touch.png">
        <link href="/no-rel.css"><link rel="preload" href="/font.woff2">
        <style>.a{color:#f00}</style>
      </head><body style="color:#0f0">
        <header><img src="/hero.jpg"><img src="/second.jpg"></header>
        <a class="site-Logo"><img src="/brand.png"></a>
        <div id="main-logo"><svg class="logo"><path class="logo" d="M0"/></svg></div>
        <img data-src="/lazy.png" alt="Company logo">
        <img srcset="/small.png 1x, /big.png 2x">
        <img src="data:image/gif;base64,R0lG">
        <img>
        <img srcset=" ">
        <nav><img data-lazy-src="/nav.png"><img data-srcset="/nav2.png 2x"></nav>
      </body></html>`);
    expect(facts.baseHref).toBe("/site/");
    expect(facts.themeColours).toEqual(["#1d4ed8"]);
    expect(facts.stylesheets).toEqual(["/a.css", "/b.css", "/c.css"]);
    expect(facts.icons).toEqual([
      { href: "/favicon.png", rel: "icon", sizes: "32x32" },
      { href: "/touch.png", rel: "apple-touch-icon", sizes: "" },
    ]);
    expect(facts.css).toEqual(expect.arrayContaining([".a{color:#f00}", "color:#0f0"]));
    expect(facts.images).toEqual([
      { src: "/hero.jpg", inHeader: true, logoish: false },
      { src: "/second.jpg", inHeader: true, logoish: false },
      { src: "/brand.png", inHeader: false, logoish: true },
      { src: "/lazy.png", inHeader: false, logoish: true },
      { src: "/small.png", inHeader: false, logoish: false },
      { src: "/nav.png", inHeader: true, logoish: false },
      { src: "/nav2.png", inHeader: true, logoish: false },
    ]);
  });

  it("collects readable words and links, without repeats", async () => {
    const facts = await extractPageFacts(`
      <html><head><title>Acme Cleaning</title><meta name="description" content="Cleaners in  Twickenham"><meta name="description"></head>
      <body><h1>Sparkling homes</h1><ul><li><p>Oven cleaning</p></li></ul><p>  </p><script>var x = 1</script>
      <a href="/services">Our <b>services</b></a><a href="/about"></a></body></html>`);
    expect(facts.text).toEqual(["Acme Cleaning", "Cleaners in Twickenham", "Sparkling homes", "Oven cleaning"]);
    expect(facts.links).toEqual([
      { href: "/services", text: "Our services" },
      { href: "/about", text: "" },
    ]);
  });

  it("caps words and links", async () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `<p>${String(i).padStart(3, "0")}${"x".repeat(297)}</p>`).join("");
    const links = Array.from({ length: 210 }, (_, i) => `<a href="/${i}">${i}</a>`).join("");
    const facts = await extractPageFacts(`<html><body>${paragraphs}${links}</body></html>`);
    expect(facts.text).toHaveLength(40);
    expect(facts.links).toHaveLength(200);
    expect(facts.links.at(-1)).toEqual({ href: "/199", text: "199" });
  });

  it("caps inline CSS and the number of images", async () => {
    const huge = `<style>${"a{color:red}".repeat(40_000)}</style>`;
    const images = Array.from({ length: 70 }, (_, i) => `<img src="/${i}.png">`).join("");
    const facts = await extractPageFacts(`<html><head>${huge}<style>b{}</style></head><body>${images}</body></html>`);
    expect(facts.css).toEqual(["b{}"]);
    expect(facts.images).toHaveLength(60);
  });
});

describe("findInfoPages", () => {
  it("picks one services page and one about page on the same site", () => {
    const pages = findInfoPages(
      [
        { href: "/", text: "Home" },
        { href: "#top", text: "About" },
        { href: "https://elsewhere.com/about", text: "About" },
        { href: "javascript:void(0)", text: "Services" },
        { href: "/pricing", text: "Prices" },
        { href: "/about-us", text: "Who we are" },
        { href: "/our-story", text: "Story" },
        { href: "/what-we-do", text: "Work" },
        { href: "/what-we-do#ovens", text: "Ovens" },
        { href: "/contact", text: "Contact" },
      ],
      `${SITE}/`
    );
    expect(pages).toEqual([`${SITE}/what-we-do`, `${SITE}/about-us`]);
  });

  it("falls back to a products page and finds nothing on a bare site", () => {
    expect(findInfoPages([{ href: "/menu", text: "" }], `${SITE}/`)).toEqual([`${SITE}/menu`]);
    expect(findInfoPages([{ href: "/contact", text: "Contact" }], `${SITE}/`)).toEqual([]);
  });
});

describe("logo ranking", () => {
  it("prefers a header logo, then other logos, the first header image, then icons", () => {
    const urls = rankLogoCandidates(
      {
        baseHref: null,
        text: [],
        links: [],
        themeColours: [],
        css: [],
        stylesheets: [],
        icons: [
          { href: "/favicon.ico", rel: "icon", sizes: "" },
          { href: "/icon.svg", rel: "icon", sizes: "" },
          { href: "/touch.png", rel: "apple-touch-icon", sizes: "180x180" },
          { href: "/icon-192.png", rel: "icon", sizes: "16x16 192x192" },
          { href: "/small.png", rel: "icon", sizes: "16x16" },
        ],
        images: [
          { src: "/footer-logo.png", logoish: true, inHeader: false },
          { src: "/hero.jpg", logoish: false, inHeader: true },
          { src: "/header-logo.png", logoish: true, inHeader: true },
          { src: "/photo.jpg", logoish: false, inHeader: false },
          { src: "/other-header.jpg", logoish: false, inHeader: true },
          { src: "data:x", logoish: true, inHeader: true },
        ],
      },
      `${SITE}/`
    );
    expect(urls).toEqual([
      `${SITE}/header-logo.png`,
      `${SITE}/footer-logo.png`,
      `${SITE}/hero.jpg`,
      `${SITE}/touch.png`,
      `${SITE}/icon-192.png`,
    ]);
  });

  it("falls back to the conventional touch icon", () => {
    const urls = rankLogoCandidates(
      { baseHref: null, text: [], links: [], themeColours: [], css: [], stylesheets: [], icons: [], images: [] },
      SITE
    );
    expect(urls).toEqual([`${SITE}/apple-touch-icon.png`]);
  });
});

describe("fetchLimited", () => {
  it("returns bytes, final URL and type", async () => {
    onFetch(`${SITE}/page`, () => new Response("hello", { headers: { "Content-Type": "text/plain" } }));
    const res = await fetchLimited(`${SITE}/page`, "text/plain", 100);
    expect(res && decodeText(res.bytes)).toBe("hello");
    expect(res?.contentType).toBe("text/plain");
  });

  it("gives up on errors, oversize bodies, empty bodies and network failures", async () => {
    onFetch(`${SITE}/404`, () => new Response("no", { status: 404 }));
    onFetch(`${SITE}/big`, () => new Response("x".repeat(200)));
    onFetch(`${SITE}/empty`, () => new Response(null, { status: 200 }));
    onFetch(`${SITE}/boom`, () => {
      throw new Error("network");
    });
    onFetch(`${SITE}/untyped`, () => new Response(new Uint8Array([1])));
    expect(await fetchLimited(`${SITE}/404`, "*/*", 100)).toBeNull();
    expect(await fetchLimited(`${SITE}/big`, "*/*", 100)).toBeNull();
    expect(await fetchLimited(`${SITE}/empty`, "*/*", 100)).toBeNull();
    expect(await fetchLimited(`${SITE}/boom`, "*/*", 100)).toBeNull();
    expect((await fetchLimited(`${SITE}/untyped`, "*/*", 100))?.contentType).toBe("");
  });
});

describe("fetchFirstLogo", () => {
  it("skips failures and non-images, and takes a raster or SVG", async () => {
    onFetch(`${SITE}/gone.png`, () => new Response("", { status: 404 }));
    onFetch(`${SITE}/page.html`, () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } }));
    onFetch(`${SITE}/logo.png`, png);
    onFetch(`${SITE}/logo.svg`, () => new Response(`<?xml version="1.0"?>\n${SVG}`));
    onFetch(`${SITE}/typed.svg`, () => new Response(SVG.replace("<svg ", "<!-- x --><svg "), { headers: { "Content-Type": "image/svg+xml" } }));
    onFetch(`${SITE}/huge.svg`, () => new Response(`${SVG}${" ".repeat(300_001)}`, { headers: { "Content-Type": "image/svg+xml" } }));

    const raster = await fetchFirstLogo([`${SITE}/gone.png`, `${SITE}/page.html`, `${SITE}/logo.png`]);
    expect(raster?.kind).toBe("raster");
    expect(await fetchFirstLogo([`${SITE}/logo.svg`])).toEqual({ kind: "svg", svg: `<?xml version="1.0"?>\n${SVG}` });
    expect((await fetchFirstLogo([`${SITE}/typed.svg`]))?.kind).toBe("svg");
    expect(await fetchFirstLogo([`${SITE}/huge.svg`])).toBeNull();
    expect(await fetchFirstLogo([])).toBeNull();
  });
});

describe("scanWebsite", () => {
  it("finds colours from inline and linked CSS and the header logo", async () => {
    onFetch(`${SITE}/`, () =>
      html(
        '<header><a class="logo"><img src="/img/logo.png"></a></header>',
        '<meta name="theme-color" content="#e11d48"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/missing.css"><link rel="stylesheet" href="data:text/css,x">'
      )
    );
    onFetch(`${SITE}/site.css`, () => new Response(":root{--primary:#1d4ed8}"));
    onFetch(`${SITE}/missing.css`, () => new Response("", { status: 404 }));
    onFetch(`${SITE}/img/logo.png`, png);

    const outcome = await scanWebsite(new URL(`${SITE}/`));
    expect(outcome.reachable).toBe(true);
    expect(outcome.colours).toEqual(["#e11d48", "#1d4ed8"]);
    expect(outcome.logo?.kind).toBe("raster");
  });

  it("reads the words of the home page and its services and about pages", async () => {
    onFetch(`${SITE}/`, () => html('<h1>Acme</h1><a href="/services">Services</a><a href="/about">About</a>'));
    onFetch(`${SITE}/services`, () => html("<li>Oven cleaning</li>"));
    onFetch(`${SITE}/about`, () => new Response("", { status: 404 }));
    const outcome = await scanWebsite(new URL(`${SITE}/`));
    expect(outcome.pageText).toBe("Acme\n\nOven cleaning");
  });

  it("honours <base href> when resolving links", async () => {
    onFetch(`${SITE}/home`, () => html('<img class="logo" src="logo.svg">', '<base href="/assets/">'));
    onFetch(`${SITE}/assets/logo.svg`, () => new Response(SVG, { headers: { "Content-Type": "image/svg+xml" } }));
    const outcome = await scanWebsite(new URL(`${SITE}/home`));
    expect(outcome.logo).toEqual({ kind: "svg", svg: SVG });
  });

  it("ignores an unusable <base href>", async () => {
    onFetch(`${SITE}/b`, () => html("", '<base href="javascript:void(0)">'));
    const outcome = await scanWebsite(new URL(`${SITE}/b`));
    expect(outcome).toEqual({ reachable: true, colours: [], logo: null, pageText: "" });
  });

  it("reports an unreachable site as nothing found", async () => {
    onFetch(`${SITE}/down`, () => new Response("", { status: 503 }));
    expect(await scanWebsite(new URL(`${SITE}/down`))).toEqual({ reachable: false, colours: [], logo: null, pageText: "" });
  });
});

describe("POST /api/profile/scan", () => {
  it("stores a detected raster logo for the account and returns colours", async () => {
    const { cookie } = await verifiedUser();
    onFetch(`${SITE}/`, () => html('<img id="logo" src="/logo.png">', '<meta name="theme-color" content="#1d4ed8">'));
    onFetch(`${SITE}/logo.png`, png);
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: "acme.example.co.uk" } });
    expect(res.status).toBe(200);
    const body: { websiteUrl: string; reachable: boolean; colours: string[]; logo: { key: string } | null; logoSvg: null } =
      await res.json();
    expect(body).toMatchObject({ websiteUrl: `${SITE}/`, reachable: true, colours: ["#1d4ed8"], logoSvg: null });
    expect(body.logo && (await testEnv.FILES.head(body.logo.key))).not.toBeNull();
  });

  it("fills in the rest of the profile from the website's words", async () => {
    const { cookie } = await verifiedUser();
    mockClaude();
    onFetch(`${SITE}/`, () => html("<h1>Acme Cleaning</h1><p>Oven cleaning in Twickenham</p>"));
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: SITE } });
    expect(await res.json()).toMatchObject({ details: DETAILS });
    const sent = callsTo(ANTHROPIC_URL).at(-1)?.body ?? "";
    expect(sent).toContain("Oven cleaning in Twickenham");
    expect(sent).toContain('"tool_choice":{"type":"tool","name":"record_profile"}');
  });

  it("still answers with colours and logo when reading the words fails", async () => {
    const { cookie } = await verifiedUser();
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 400 }));
    onFetch(`${SITE}/`, () => html("<p>Words</p>", '<meta name="theme-color" content="#1d4ed8">'));
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: SITE } });
    expect(await res.json()).toMatchObject({ colours: ["#1d4ed8"], details: null });
  });

  it("hands an SVG logo back to the browser to convert", async () => {
    const { cookie } = await verifiedUser();
    onFetch(`${SITE}/`, () => html('<img alt="logo" src="/logo.svg">'));
    onFetch(`${SITE}/logo.svg`, () => new Response(SVG, { headers: { "Content-Type": "image/svg+xml" } }));
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: SITE } });
    expect(await res.json()).toMatchObject({ logo: null, logoSvg: SVG });
  });

  it("answers an unreachable site with nothing found, never an error", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: "nowhere.example.com" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reachable: false, colours: [], logo: null, logoSvg: null, details: null });
  });

  it("refuses when the account has scanned too many times in a minute", async () => {
    const { cookie } = await verifiedUser();
    onFetch(`${SITE}/`, () => html(""));
    for (let i = 0; i < 20; i++) {
      expect((await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: SITE } })).status).toBe(200);
    }
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: SITE } });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limit" });
  });

  it("rejects addresses that are not public websites", async () => {
    const { cookie } = await verifiedUser();
    const res = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { url: "localhost:8787" } });
    expect(res.status).toBe(400);
    const bad = await apiFetch(cookie, "/api/profile/scan", { method: "POST", body: { nope: 1 } });
    expect(bad.status).toBe(400);
  });
});
