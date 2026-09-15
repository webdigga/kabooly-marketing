const TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; KaboolyMarketingBot/1.0; +https://marketing.kabooly.com)";

export interface Fetched {
  url: string;
  contentType: string;
  bytes: Uint8Array;
}

// Reads at most maxBytes, so a huge or endless response cannot hold the
// Worker. Anything that fails, times out or runs over yields null.
async function readCapped(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchLimited(
  url: string,
  accept: string,
  maxBytes: number
): Promise<Fetched | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) return null;
    const bytes = await readCapped(res.body as ReadableStream<Uint8Array>, maxBytes);
    if (!bytes) return null;
    return {
      url: res.url || url,
      contentType: res.headers.get("Content-Type") ?? "",
      bytes,
    };
  } catch {
    return null;
  }
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
