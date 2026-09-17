// Branded layout for Kabooly account emails: a white card with the Kabooly
// signature underneath, plus a plain text version for clients without HTML.
//
// Keep the markup identical to kabooly.com (server/email.ts) and the CRM
// (worker/src/utils/emailLayout.ts) so every account email looks the same.
// The logo image is served by kabooly.com.

const LOGO_URL = "https://kabooly.com/email/kabooly-logo.png";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
const TEXT_SIGNATURE = "Thanks,\nThe Kabooly Team\n\nkabooly.com";

export interface EmailContent {
  paragraphs: string[];
  /** A button after the paragraphs; the text version gives the bare link. */
  button?: { href: string; label: string };
  /** Paragraphs after the button. */
  after?: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailLayout(bodyHtml: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;font-family:${FONT};font-size:16px;line-height:1.6;color:#374151;">
${bodyHtml}
<p style="margin:24px 0 0;">Thanks,<br>The Kabooly Team</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e5e7eb;"><tr><td style="padding-top:20px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:10px;"><img src="${LOGO_URL}" width="28" height="28" alt="" style="display:block;border:0;"></td>
<td style="vertical-align:middle;font-family:${FONT};font-size:18px;font-weight:700;color:#111827;">Kabooly</td>
</tr></table>
<p style="margin:10px 0 0;font-family:${FONT};font-size:14px;"><a href="https://kabooly.com" style="color:#1d4ed8;text-decoration:none;">kabooly.com</a></p>
</td></tr></table>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

const paragraphHtml = (p: string): string => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`;

export function renderEmail({ paragraphs, button, after = [] }: EmailContent): { html: string; text: string } {
  const buttonHtml = button
    ? [
        `<p style="margin:24px 0;"><a href="${escapeHtml(button.href)}" style="background-color:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">${escapeHtml(button.label)}</a></p>`,
      ]
    : [];
  const html = [...paragraphs.map(paragraphHtml), ...buttonHtml, ...after.map(paragraphHtml)].join("\n");
  const text = [...paragraphs, ...(button ? [button.href] : []), ...after, TEXT_SIGNATURE].join("\n\n");
  return { html: emailLayout(html), text };
}
