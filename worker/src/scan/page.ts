// Pulls the facts the scan needs out of a page's HTML in one streaming pass:
// theme colours, CSS (inline and linked), icon links, and every image with
// enough context (inside a header, inside something called "logo") to tell
// a logo from a photo.

export interface IconLink {
  href: string;
  rel: string;
  sizes: string;
}

export interface ImageRef {
  src: string;
  logoish: boolean;
  inHeader: boolean;
}

export interface PageLink {
  href: string;
  text: string;
}

export interface PageFacts {
  baseHref: string | null;
  // Readable words (title, description, headings, paragraphs, list items),
  // for reading what the business does.
  text: string[];
  links: PageLink[];
  themeColours: string[];
  css: string[];
  stylesheets: string[];
  icons: IconLink[];
  images: ImageRef[];
}

const MAX_INLINE_CSS = 400_000;
const MAX_STYLESHEETS = 3;
const MAX_IMAGES = 60;
const MAX_TEXT = 12_000;
const MAX_LINKS = 200;

function mentionsLogo(...values: (string | null)[]): boolean {
  return values.some((v) => v?.toLowerCase().includes("logo"));
}

function imageSource(el: Element): string | null {
  const src =
    el.getAttribute("src") ??
    el.getAttribute("data-src") ??
    el.getAttribute("data-lazy-src");
  if (src && !src.startsWith("data:")) return src;
  const srcset = el.getAttribute("srcset") ?? el.getAttribute("data-srcset");
  return srcset?.trim().split(/\s+/).find(Boolean) ?? null;
}

class Collector {
  facts: PageFacts = {
    baseHref: null,
    text: [],
    links: [],
    themeColours: [],
    css: [],
    stylesheets: [],
    icons: [],
    images: [],
  };
  private headerDepth = 0;
  private logoDepth = 0;
  private inlineCssSize = 0;
  private styleText = "";
  private textSize = 0;
  private pendingText = "";
  private anchor: PageLink | null = null;

  // Tracks nesting so an <img> knows whether it sits in a header or logo.
  // Void and self-closing elements have no end tag (onEndTag throws for
  // them), so they never open a context.
  enter(el: Element, kind: "header" | "logo"): void {
    const step = (delta: number) => {
      if (kind === "header") this.headerDepth += delta;
      else this.logoDepth += delta;
    };
    try {
      el.onEndTag(() => {
        step(-1);
      });
    } catch {
      return;
    }
    step(1);
  }

  link(el: Element): void {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase();
    // The selector guarantees an href.
    const href = String(el.getAttribute("href"));
    if (rel.split(/\s+/).includes("stylesheet")) {
      if (this.facts.stylesheets.length < MAX_STYLESHEETS) this.facts.stylesheets.push(href);
      return;
    }
    if (rel.includes("icon") && !rel.includes("mask")) {
      this.facts.icons.push({ href, rel, sizes: el.getAttribute("sizes") ?? "" });
    }
  }

  image(el: Element): void {
    const src = imageSource(el);
    if (!src || this.facts.images.length >= MAX_IMAGES) return;
    this.facts.images.push({
      src,
      inHeader: this.headerDepth > 0,
      logoish:
        this.logoDepth > 0 ||
        mentionsLogo(src, el.getAttribute("alt"), el.getAttribute("class"), el.getAttribute("id")),
    });
  }

  addCss(css: string): void {
    if (this.inlineCssSize + css.length > MAX_INLINE_CSS) return;
    this.inlineCssSize += css.length;
    this.facts.css.push(css);
  }

  addText(value: string): void {
    const clean = value.replace(/\s+/g, " ").trim();
    // Nested matches (a <p> inside an <li>) hand over the same words twice.
    if (!clean || this.facts.text.includes(clean) || this.textSize + clean.length > MAX_TEXT) return;
    this.textSize += clean.length;
    this.facts.text.push(clean);
  }

  textChunk(chunk: Text): void {
    this.pendingText += chunk.text;
    if (chunk.lastInTextNode) {
      this.addText(this.pendingText);
      this.pendingText = "";
    }
  }

  // Links are kept with their words so "About us" and "Our services" pages
  // can be found. The selector guarantees an href.
  startLink(el: Element): void {
    if (this.facts.links.length >= MAX_LINKS) {
      this.anchor = null;
      return;
    }
    const link = { href: String(el.getAttribute("href")), text: "" };
    this.facts.links.push(link);
    this.anchor = link;
  }

  linkText(chunk: Text): void {
    if (this.anchor) this.anchor.text = `${this.anchor.text}${chunk.text}`.slice(0, 100);
  }

  styleChunk(chunk: Text): void {
    this.styleText += chunk.text;
    if (chunk.lastInTextNode) {
      this.addCss(this.styleText);
      this.styleText = "";
    }
  }
}

export async function extractPageFacts(html: string): Promise<PageFacts> {
  const c = new Collector();
  const rewriter = new HTMLRewriter()
    .on("base[href]", {
      element: (el) => {
        c.facts.baseHref ??= el.getAttribute("href");
      },
    })
    .on('meta[name="theme-color"]', {
      element: (el) => {
        const content = el.getAttribute("content");
        if (content) c.facts.themeColours.push(content);
      },
    })
    .on("link[href]", { element: (el) => { c.link(el); } })
    .on("style", { text: (chunk) => { c.styleChunk(chunk); } })
    .on("[style]", { element: (el) => { c.addCss(String(el.getAttribute("style"))); } })
    .on("header", { element: (el) => { c.enter(el, "header"); } })
    .on("nav", { element: (el) => { c.enter(el, "header"); } })
    .on('[class*="logo"]', { element: (el) => { c.enter(el, "logo"); } })
    .on('[class*="Logo"]', { element: (el) => { c.enter(el, "logo"); } })
    .on('[id*="logo"]', { element: (el) => { c.enter(el, "logo"); } })
    .on("img", { element: (el) => { c.image(el); } })
    .on('meta[name="description"]', {
      element: (el) => {
        c.addText(el.getAttribute("content") ?? "");
      },
    })
    .on("title, h1, h2, h3, p, li", { text: (chunk) => { c.textChunk(chunk); } })
    .on("a[href]", {
      element: (el) => { c.startLink(el); },
      text: (chunk) => { c.linkText(chunk); },
    });
  await rewriter.transform(new Response(html)).arrayBuffer();
  return c.facts;
}
