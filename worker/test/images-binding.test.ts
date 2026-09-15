import { describe, expect, it } from "vitest";
import { fitToPlatform } from "../src/image-maker";
import { pngBytes, testEnv } from "./helpers";

describe("fitToPlatform", () => {
  it("returns a JPEG at the platform's exact size", async () => {
    const out = await fitToPlatform(testEnv, pngBytes(), "facebook");
    expect([out[0], out[1], out[2]]).toEqual([0xff, 0xd8, 0xff]);
    const info = await testEnv.IMAGES.info(
      new ReadableStream({
        start(c) {
          c.enqueue(out);
          c.close();
        },
      })
    );
    expect(info).toMatchObject({ width: 1200, height: 630 });
  });
});
