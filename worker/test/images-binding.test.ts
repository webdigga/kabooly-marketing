import { describe, expect, it } from "vitest";
import { brandGenerated, brandPhoto, fitToShape, streamOf } from "../src/image-maker";
import { CAROUSEL_SHAPE } from "../src/platforms";
import { pngBytes, testEnv } from "./helpers";

async function sizeOf(bytes: Uint8Array) {
  return testEnv.IMAGES.info(streamOf(bytes));
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

describe("fitToShape", () => {
  it("returns a JPEG at an exact size, such as a carousel slide", async () => {
    const out = await fitToShape(testEnv, pngBytes(), CAROUSEL_SHAPE);
    expect(isJpeg(out)).toBe(true);
    expect(await sizeOf(out)).toMatchObject({ width: 1080, height: 1350 });
  });
});

describe("branding", () => {
  it("crops a generated image to the platform size, with or without the brand strip", async () => {
    const branded = await brandGenerated(testEnv, pngBytes(), "facebook", pngBytes());
    expect(isJpeg(branded)).toBe(true);
    expect(await sizeOf(branded)).toMatchObject({ width: 1200, height: 630 });
    const plain = await brandGenerated(testEnv, pngBytes(), "instagram", null);
    expect(await sizeOf(plain)).toMatchObject({ width: 1080, height: 1080 });
  });

  it("crops and brands a customer's own photo", async () => {
    const branded = await brandPhoto(testEnv, pngBytes(), "nextdoor", pngBytes());
    expect(await sizeOf(branded)).toMatchObject({ width: 1200, height: 1200 });
    const plain = await brandPhoto(testEnv, pngBytes(), "instagram", null);
    expect(await sizeOf(plain)).toMatchObject({ width: 1080, height: 1080 });
  });
});
