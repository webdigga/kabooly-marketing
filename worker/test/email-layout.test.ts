import { describe, expect, it } from "vitest";
import { renderEmail } from "../src/email-layout";

describe("renderEmail", () => {
  it("adds the Kabooly signature to the HTML and text versions", () => {
    const { html, text } = renderEmail({ paragraphs: ["Hi Sam,", "Your code is 123456"] });
    expect(html).toContain('src="https://kabooly.com/email/kabooly-logo.png"');
    expect(html).toContain("Thanks,<br>The Kabooly Team");
    expect(text).toBe("Hi Sam,\n\nYour code is 123456\n\nThanks,\nThe Kabooly Team\n\nkabooly.com");
  });

  it("places the button between the paragraphs and the follow-up text", () => {
    const { html, text } = renderEmail({
      paragraphs: ["Choose your password:"],
      button: { href: "https://marketing.kabooly.com/set-password?token=abc", label: "Choose your password" },
      after: ["This link works for 7 days."],
    });
    expect(text).toMatch(/^Choose your password:\n\nhttps:\/\/marketing\.kabooly\.com\/set-password\?token=abc\n\nThis link works for 7 days\./);
    expect(html.indexOf("set-password?token=abc")).toBeLessThan(html.indexOf("This link works"));
  });

  it("escapes text in the HTML version", () => {
    const { html, text } = renderEmail({ paragraphs: ["Hi <b>Sam</b> & co,"] });
    expect(html).toContain("Hi &lt;b&gt;Sam&lt;/b&gt; &amp; co,");
    expect(text).toContain("Hi <b>Sam</b> & co,");
  });
});
