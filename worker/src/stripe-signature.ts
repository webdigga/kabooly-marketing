// Stripe webhook signature check, the same algorithm the CRM worker uses
// (kabooly-crm/worker/src/utils/stripe.ts verifyWebhookSignature): HMAC-SHA256
// over `${timestamp}.${payload}`, constant-time compare, 5 minute tolerance.

const TOLERANCE_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function parseHeader(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const parsed = parseHeader(header);
  if (!parsed || Math.abs(nowSeconds - parsed.timestamp) > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${String(parsed.timestamp)}.${payload}`))
  );
  return parsed.signatures.some((signature) => {
    const bytes = hexToBytes(signature);
    return bytes !== null && bytes.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(bytes, expected);
  });
}
