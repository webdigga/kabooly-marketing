import { describe, expect, it } from "vitest";
import { brandPhoto, fitToPlatform, fitToShape, solidPng, streamOf } from "../src/image-maker";
import { CAROUSEL_SHAPE } from "../src/platforms";
import { pngBytes, testEnv } from "./helpers";

async function sizeOf(bytes: Uint8Array) {
  return testEnv.IMAGES.info(streamOf(bytes));
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

describe("fitToPlatform", () => {
  it("returns a JPEG at the platform's exact size", async () => {
    const out = await fitToPlatform(testEnv, pngBytes(), "facebook");
    expect(isJpeg(out)).toBe(true);
    expect(await sizeOf(out)).toMatchObject({ width: 1200, height: 630 });
  });

  it("fits any shape, such as a carousel slide", async () => {
    expect(await sizeOf(await fitToShape(testEnv, pngBytes(), CAROUSEL_SHAPE))).toMatchObject({ width: 1080, height: 1350 });
  });
});

describe("solidPng", () => {
  it("makes a readable one-pixel PNG of the colour", async () => {
    const png = await solidPng("#1d4ed8");
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(await sizeOf(png)).toMatchObject({ width: 1, height: 1 });
  });
});

describe("brandPhoto", () => {
  it("cuts the photo to the platform size, with or without the logo strip", async () => {
    const branded = await brandPhoto(testEnv, pngBytes(), "nextdoor", { logo: pngBytes(), colour: "#1d4ed8" });
    expect(isJpeg(branded)).toBe(true);
    expect(await sizeOf(branded)).toMatchObject({ width: 1200, height: 1200 });
    const whiteEdge = await brandPhoto(testEnv, pngBytes(), "instagram", { logo: pngBytes(), colour: null });
    expect(await sizeOf(whiteEdge)).toMatchObject({ width: 1080, height: 1080 });
    const plain = await brandPhoto(testEnv, pngBytes(), "facebook", { logo: null, colour: null });
    expect(await sizeOf(plain)).toMatchObject({ width: 1200, height: 630 });
  });
});
