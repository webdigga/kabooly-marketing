const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// Accepts what people type ("acme.co.uk", "www.acme.co.uk/about") and
// returns a public http(s) URL, or null for anything that is not a normal
// website address: no IP literals, no localhost, no other schemes.
function parse(input: string): URL | null {
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function isPublicHost(host: string): boolean {
  if (!host.includes(".") || IPV4.test(host) || host.startsWith("[")) return false;
  return !host.endsWith(".localhost") && !host.endsWith(".local");
}

export function normaliseWebsiteUrl(input: string): URL | null {
  const url = parse(input.trim());
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  if (!isPublicHost(url.hostname) || url.username || url.password) return null;
  url.hash = "";
  return url;
}

export function resolveUrl(href: string, base: string): string | null {
  if (href.startsWith("data:")) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
