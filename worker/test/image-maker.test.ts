import { beforeEach, describe, expect, it } from "vitest";
import { bytesToBase64, generateImage, ImageError, imagePrompt } from "../src/image-maker";
import type { Profile } from "../src/profile";
import { GEMINI_URL, geminiImage } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { pngBytes, PNG_BASE64, testEnv } from "./helpers";

const profile: Profile = {
  businessName: "Acme Cleaning",
  description: "Domestic cleaning",
  websiteUrl: null,
  targetAudience: "Busy families",
  localArea: "Twickenham",
  tone: 3,
  services: ["Oven cleaning"],
  brandColours: ["#1d4ed8", "#f59e0b"],
  logoKey: null,
};

beforeEach(() => {
  installFetchMock();
});

describe("imagePrompt", () => {
  it("brings in brand colours, the logo and a crop warning for Facebook", () => {
    const prompt = imagePrompt(profile, "Spring ovens", "facebook", true);
    expect(prompt).toContain("Facebook advert image for Acme Cleaning");
    expect(prompt).toContain("#1d4ed8, #f59e0b");
    expect(prompt).toContain("attached image is the business logo");
    expect(prompt).toContain("cropped slightly");
    expect(prompt).toContain("Do not add any words");
  });

  it("leaves out what does not apply", () => {
    const prompt = imagePrompt({ ...profile, brandColours: [] }, "Spring ovens", "instagram", false);
    expect(prompt).not.toContain("brand colours");
    expect(prompt).not.toContain("logo");
    expect(prompt).not.toContain("cropped");
  });
});

describe("bytesToBase64", () => {
  it("round-trips bytes, including inputs larger than one chunk", () => {
    expect(bytesToBase64(pngBytes())).toBe(PNG_BASE64);
    const big = new Uint8Array(0x8000 * 2 + 5).fill(65);
    expect(atob(bytesToBase64(big))).toHaveLength(big.length);
  });
});

describe("generateImage", () => {
  it("sends the prompt, logo and shape to Gemini without storing the interaction", async () => {
    onFetch(GEMINI_URL, () => Response.json(geminiImage()));
    const bytes = await generateImage(testEnv, "prompt", "facebook", { mimeType: "image/png", base64: "TE9HTw==" });
    expect(bytes).toEqual(pngBytes());
    const call = callsTo(GEMINI_URL)[0];
    const body = JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gemini-3.1-flash-image",
      store: false,
      input: [
        { type: "text", text: "prompt" },
        { type: "image", mime_type: "image/png", data: "TE9HTw==" },
      ],
      response_format: { type: "image", aspect_ratio: "16:9", image_size: "2K" },
    });
  });

  it("sends only text when there is no logo", async () => {
    onFetch(GEMINI_URL, () => Response.json(geminiImage()));
    await generateImage(testEnv, "prompt", "instagram", null);
    const body = JSON.parse(callsTo(GEMINI_URL)[0]?.body ?? "{}") as { input: unknown[]; response_format: { aspect_ratio: string } };
    expect(body.input).toHaveLength(1);
    expect(body.response_format.aspect_ratio).toBe("1:1");
  });

  it.each([
    ["an HTTP error", () => new Response("quota", { status: 429 })],
    ["no image", () => Response.json({ status: "completed", steps: [{ type: "model_output" }] })],
    ["no steps", () => Response.json({ status: "failed" })],
    ["an unreadable image", () => Response.json(geminiImage(btoa("not an image")))],
    [
      "a network failure",
      () => {
        throw new Error("offline");
      },
    ],
  ])("throws an ImageError on %s", async (_label, handler) => {
    onFetch(GEMINI_URL, handler);
    await expect(generateImage(testEnv, "p", "nextdoor", null)).rejects.toBeInstanceOf(ImageError);
  });
});
