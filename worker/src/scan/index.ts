import { detectBrandColours } from "./colours";
import { decodeText, fetchLimited } from "./fetch-limited";
import { fetchFirstLogo, rankLogoCandidates } from "./logo";
import type { LogoFind } from "./logo";
import { findInfoPages } from "./info-pages";
import { extractPageFacts } from "./page";
import { resolveUrl } from "./url";

export interface ScanOutcome {
  reachable: boolean;
  colours: string[];
  logo: LogoFind | null;
  // The readable words of the home page and up to two pages about the
  // business, for filling in the rest of the profile.
  pageText: string;
}

const MAX_PAGE_BYTES = 1_500_000;
const MAX_STYLESHEET_BYTES = 400_000;

const UNREACHABLE: ScanOutcome = { reachable: false, colours: [], logo: null, pageText: "" };

async function fetchPageText(url: string): Promise<string | null> {
  const page = await fetchLimited(url, "text/html", MAX_PAGE_BYTES);
  if (!page) return null;
  return (await extractPageFacts(decodeText(page.bytes))).text.join("\n");
}

async function fetchStylesheets(hrefs: string[], base: string): Promise<string[]> {
  const sheets = await Promise.all(
    hrefs.map(async (href) => {
      const url = resolveUrl(href, base);
      if (!url) return null;
      const res = await fetchLimited(url, "text/css,*/*;q=0.1", MAX_STYLESHEET_BYTES);
      return res ? decodeText(res.bytes) : null;
    })
  );
  return sheets.filter((s): s is string => s !== null);
}

// Best effort by design: an unreachable site comes back as "nothing found"
// and the user fills things in (the app treats any error the same way).
export async function scanWebsite(url: URL): Promise<ScanOutcome> {
  const page = await fetchLimited(url.toString(), "text/html", MAX_PAGE_BYTES);
  if (!page) return UNREACHABLE;
  const facts = await extractPageFacts(decodeText(page.bytes));
  const base = (facts.baseHref && resolveUrl(facts.baseHref, page.url)) ?? page.url;
  const [sheets, logo, infoTexts] = await Promise.all([
    fetchStylesheets(facts.stylesheets, base),
    fetchFirstLogo(rankLogoCandidates(facts, base)),
    Promise.all(findInfoPages(facts.links, base).map(fetchPageText)),
  ]);
  return {
    reachable: true,
    colours: detectBrandColours([...facts.css, ...sheets], facts.themeColours),
    logo,
    pageText: [facts.text.join("\n"), ...infoTexts.filter((t) => t !== null)].join("\n\n"),
  };
}
