import { detectBrandColours } from "./colours";
import { decodeText, fetchLimited } from "./fetch-limited";
import { fetchFirstLogo, rankLogoCandidates } from "./logo";
import type { FoundLogo } from "./logo";
import { extractPageFacts } from "./page";
import { resolveUrl } from "./url";

export interface ScanOutcome {
  reachable: boolean;
  colours: string[];
  logo: FoundLogo | null;
}

const MAX_PAGE_BYTES = 1_500_000;
const MAX_STYLESHEET_BYTES = 400_000;

const UNREACHABLE: ScanOutcome = { reachable: false, colours: [], logo: null };

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
  const [sheets, logo] = await Promise.all([
    fetchStylesheets(facts.stylesheets, base),
    fetchFirstLogo(rankLogoCandidates(facts, base)),
  ]);
  return {
    reachable: true,
    colours: detectBrandColours([...facts.css, ...sheets], facts.themeColours),
    logo,
  };
}
