import { beforeEach, describe, expect, it } from "vitest";
import type { AdvertJson } from "../src/advert-store";
import type { GenerationEvent } from "../src/generation";
import type { Profile } from "../src/profile";
import { checkVideo, deleteVideoJob, startVideo, VIDEO_JOB_TTL_MS, videoPrompt, VideoError } from "../src/video-maker";
import { findVideo, refreshVideo } from "../src/video-store";
import type { VideoJson } from "../src/video-store";
import { ANTHROPIC_URL, GEMINI_URL, geminiImage, geminiVideo, mockClaude, mockGemini, MP4_BYTES, VIDEO_PLAN } from "./ai-mocks";
import { callsTo, installFetchMock, onFetch } from "./fetch-mock";
import { apiFetch, mockEmail, testEnv, uploadLogo, verifiedUser, withProfile } from "./helpers";

beforeEach(() => {
  installFetchMock();
  mockEmail();
  mockClaude();
  mockGemini();
});

const profile: Profile = {
  businessName: "Acme Cleaning",
  description: "Domestic cleaning",
  websiteUrl: null,
  targetAudience: "Busy families",
  localArea: "Twickenham",
  tone: 3,
  services: ["Oven cleaning"],
  brandColours: [],
  logoKey: null,
};

const JOB_URL = `${GEMINI_URL}/v1_video`;

describe("videoPrompt", () => {
  it("films the planned shots with their captions and an end card", () => {
    const prompt = videoPrompt(profile, VIDEO_PLAN, true);
    expect(prompt).toContain("[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]");
    expect(prompt).toContain("A 10 second vertical");
    expect(prompt).toContain('[0-3s] Slow push in on a greasy oven door in a bright kitchen. On screen, the words "Dreading your oven?"');
    expect(prompt).toContain('[3-5s] Cut to: Gloved hands wipe the oven glass clean. On screen, the words "We deep clean it"');
    expect(prompt).toContain('[5-7s] Cut to: Pan across the sparkling finished oven. On screen, the words "Like new again"');
    expect(prompt).toContain('[7-10s] Cut to an end card');
    expect(prompt).toContain('"Acme Cleaning" in large bold letters, and below it "Book your clean today"');
    expect(prompt).toContain("Audio: upbeat acoustic guitar. No dialogue");
    expect(prompt).toContain("Image2 is the business logo");
  });

  it("leaves out the logo reference when there is no logo", () => {
    const prompt = videoPrompt(profile, VIDEO_PLAN, false);
    expect(prompt.startsWith("[# Sources <FIRST_FRAME>@Image1]\n")).toBe(true);
    expect(prompt).not.toContain("Image2");
  });
});

describe("startVideo", () => {
  it("starts a stored background job with the frame, logo and prompt", async () => {
    const id = await startVideo(testEnv, new Uint8Array([1, 2, 3]), { mimeType: "image/png", base64: "TE9HTw==" }, "go");
    expect(id).toBe("v1_video");
    const body = JSON.parse(callsTo(GEMINI_URL).at(-1)?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gemini-omni-1.1-flash",
      background: true,
      input: [
        { type: "image", mime_type: "image/jpeg", data: "AQID" },
        { type: "image", mime_type: "image/png", data: "TE9HTw==" },
        { type: "text", text: "go" },
      ],
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "1080p" },
    });
    expect(body).not.toHaveProperty("store");
    await startVideo(testEnv, new Uint8Array([1]), null, "go");
    const plain = JSON.parse(callsTo(GEMINI_URL).at(-1)?.body ?? "{}") as { input: unknown[] };
    expect(plain.input).toHaveLength(2);
  });

  it.each([
    ["an HTTP error", () => new Response("quota", { status: 429 })],
    ["no job id", () => Response.json({ status: "in_progress" })],
    [
      "a network failure",
      () => {
        throw new Error("offline");
      },
    ],
  ])("throws a VideoError on %s", async (_label, handler) => {
    onFetch(GEMINI_URL, handler);
    await expect(startVideo(testEnv, new Uint8Array([1]), null, "go")).rejects.toBeInstanceOf(VideoError);
  });
});

describe("checkVideo", () => {
  it("reports running, failed and finished jobs", async () => {
    onFetch(JOB_URL, () => Response.json({ status: "in_progress" }));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "running" });
    onFetch(JOB_URL, () => Response.json({}));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "running" });
    onFetch(JOB_URL, () => Response.json({ status: "cancelled" }));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "failed", reason: "job cancelled" });
    onFetch(JOB_URL, () => Response.json({ status: "completed", steps: [] }));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "failed", reason: "completed without a video" });
    onFetch(JOB_URL, () => Response.json(geminiVideo()));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "done", bytes: MP4_BYTES });
  });

  it("downloads a video Google returns as a link", async () => {
    onFetch(JOB_URL, () => Response.json(geminiVideo("completed", { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc:download" })));
    onFetch("https://generativelanguage.googleapis.com/v1beta/files/abc", () => new Response(MP4_BYTES));
    expect(await checkVideo(testEnv, "v1_video")).toEqual({ state: "done", bytes: MP4_BYTES });
    expect(callsTo("https://generativelanguage.googleapis.com/v1beta/files/")).toHaveLength(1);
  });

  it("throws when Google cannot be asked", async () => {
    onFetch(JOB_URL, () => new Response("", { status: 500 }));
    await expect(checkVideo(testEnv, "v1_video")).rejects.toBeInstanceOf(VideoError);
  });
});

describe("deleteVideoJob", () => {
  it("deletes the stored job and shrugs off failures", async () => {
    await deleteVideoJob(testEnv, "v1_video");
    expect(callsTo(JOB_URL).at(-1)?.method).toBe("DELETE");
    onFetch(JOB_URL, () => new Response("", { status: 404 }));
    await expect(deleteVideoJob(testEnv, "v1_video")).resolves.toBeUndefined();
  });
});

async function readyUser(): Promise<string> {
  const { cookie } = await verifiedUser();
  await withProfile(cookie);
  return cookie;
}

async function textAdvert(cookie: string): Promise<AdvertJson> {
  const res = await apiFetch(cookie, "/api/generations", { method: "POST", body: { topic: "Spring ovens", platforms: [] } });
  const first = JSON.parse((await res.text()).split("\n")[0] ?? "{}") as GenerationEvent;
  if (first.type !== "advert") throw new Error("no advert");
  return first.advert;
}

function startVideoFor(cookie: string, id: string, motion?: string | null): Promise<Response> {
  return apiFetch(cookie, `/api/posts/${id}/video`, { method: "POST", body: motion === undefined ? {} : { motion } });
}

async function checkOn(cookie: string, id: string): Promise<VideoJson> {
  const res = await apiFetch(cookie, `/api/posts/${id}/video`);
  const body: { video: VideoJson } = await res.json();
  return body.video;
}

async function videosUsed(cookie: string): Promise<number> {
  const usage: { videosThisMonth: { used: number } } = await (await apiFetch(cookie, "/api/usage")).json();
  return usage.videosThisMonth.used;
}

function keyOf(url: string): string {
  return url.replace("/api/files/", "");
}

describe("video routes", () => {
  it("starts a video from a vertical frame, then saves it once Google has made it", async () => {
    const { cookie } = await verifiedUser();
    const { key }: { key: string } = await (await uploadLogo(cookie)).json();
    await withProfile(cookie, { logoKey: key });
    const advert = await textAdvert(cookie);

    const res = await startVideoFor(cookie, advert.id, "  Steam rises from a clean oven ");
    expect(res.status).toBe(202);
    const started: { video: VideoJson; usage: { videosThisMonth: { used: number } } } = await res.json();
    expect(started.video).toMatchObject({ status: "pending", motion: "Steam rises from a clean oven", video: null });
    expect(started.usage.videosThisMonth.used).toBe(1);
    const imageCall = callsTo(GEMINI_URL).find((c) => c.body.includes('"aspect_ratio":"9:16"') && c.body.includes("opening frame"));
    expect(imageCall?.body).toContain('"mime_type":"image/png"');
    const start = await testEnv.FILES.get(keyOf(started.video.start.url));
    expect(start?.httpMetadata?.contentType).toBe("image/jpeg");
    await start?.arrayBuffer();

    const ready = await checkOn(cookie, advert.id);
    expect(ready.status).toBe("ready");
    expect(ready.video?.downloadUrl).toMatch(/kabooly-video-\d{4}-\d{2}-\d{2}\.mp4$/);
    const served = await apiFetch(cookie, ready.video?.url ?? "");
    expect(served.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(MP4_BYTES);
    expect(callsTo(JOB_URL).some((c) => c.method === "DELETE")).toBe(true);
    expect(await videosUsed(cookie)).toBe(1);
  });

  it("plans the shots first, opens on the hook scene and films the captions", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    await startVideoFor(cookie, advert.id, "Steam rises from a clean oven");
    expect(callsTo(ANTHROPIC_URL).at(-1)?.body).toContain("The business owner wants the video to show: Steam rises from a clean oven");
    const frame = callsTo(GEMINI_URL).find((c) => c.body.includes("opening frame"));
    expect(frame?.body).toContain("The scene: Slow push in on a greasy oven door");
    expect(callsTo(GEMINI_URL).find((c) => c.body.includes('"background":true'))?.body).toContain("Dreading your oven?");
  });

  it("shows the video with the advert and in the library", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    await startVideoFor(cookie, advert.id);
    await checkOn(cookie, advert.id);
    const detail: { advert: AdvertJson } = await (await apiFetch(cookie, `/api/posts/${advert.id}`)).json();
    expect(detail.advert.video?.status).toBe("ready");
    const library: { adverts: AdvertJson[] } = await (await apiFetch(cookie, "/api/posts")).json();
    expect(library.adverts[0]?.video?.status).toBe("ready");
  });

  it("keeps a video pending while Google works, and refuses a second one meanwhile", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    onFetch(JOB_URL, () => Response.json({ status: "in_progress" }));
    expect((await startVideoFor(cookie, advert.id, null)).status).toBe(202);
    expect((await checkOn(cookie, advert.id)).status).toBe("pending");
    const again = await startVideoFor(cookie, advert.id);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "video_pending" });
    onFetch(JOB_URL, () => new Response("", { status: 500 }));
    expect((await checkOn(cookie, advert.id)).status).toBe("pending");
  });

  it("marks a failed video and gives the video back", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    onFetch(JOB_URL, () => Response.json({ status: "failed" }));
    await startVideoFor(cookie, advert.id);
    expect(await videosUsed(cookie)).toBe(1);
    expect((await checkOn(cookie, advert.id)).status).toBe("failed");
    expect(await videosUsed(cookie)).toBe(0);
  });

  it("replaces a finished video, removing the old files", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    await startVideoFor(cookie, advert.id);
    const first = await checkOn(cookie, advert.id);
    expect((await startVideoFor(cookie, advert.id)).status).toBe(202);
    expect(await testEnv.FILES.head(keyOf(first.start.url))).toBeNull();
    expect(await testEnv.FILES.head(keyOf(first.video?.url ?? ""))).toBeNull();
    expect(await videosUsed(cookie)).toBe(2);
  });

  it("answers 502 and refunds when the shots cannot be planned", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    onFetch(ANTHROPIC_URL, () => new Response("{}", { status: 500 }));
    expect((await startVideoFor(cookie, advert.id)).status).toBe(502);
    expect(await videosUsed(cookie)).toBe(0);
  });

  it("answers 502 and refunds when the video cannot be started", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    onFetch(GEMINI_URL, async (req) => {
      const body: { background?: boolean } = await req.json();
      return body.background ? new Response("no", { status: 400 }) : Response.json(geminiImage());
    });
    expect((await startVideoFor(cookie, advert.id)).status).toBe(502);
    expect(await videosUsed(cookie)).toBe(0);
    expect((await apiFetch(cookie, `/api/posts/${advert.id}/video`)).status).toBe(404);
  });

  it("validates, needs a profile, and hides other accounts' adverts", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    const long = await startVideoFor(cookie, advert.id, "x".repeat(301));
    expect(long.status).toBe(400);
    const { cookie: other } = await verifiedUser();
    expect((await startVideoFor(other, advert.id)).status).toBe(404);
    expect((await apiFetch(other, `/api/posts/${advert.id}/video`)).status).toBe(404);
    await testEnv.DB.prepare("DELETE FROM business_profiles WHERE user_id = (SELECT user_id FROM adverts WHERE id = ?1)")
      .bind(advert.id)
      .run();
    expect((await startVideoFor(cookie, advert.id)).status).toBe(409);
  });

  it("deletes video files with the advert", async () => {
    const cookie = await readyUser();
    const advert = await textAdvert(cookie);
    await startVideoFor(cookie, advert.id);
    const video = await checkOn(cookie, advert.id);
    await apiFetch(cookie, `/api/posts/${advert.id}`, { method: "DELETE" });
    expect(await testEnv.FILES.head(keyOf(video.start.url))).toBeNull();
    expect(await testEnv.FILES.head(keyOf(video.video?.url ?? ""))).toBeNull();
  });
});

describe("refreshVideo", () => {
  async function pendingRow(cookie: string) {
    const advert = await textAdvert(cookie);
    await startVideoFor(cookie, advert.id);
    const row = await findVideo(testEnv, advert.id);
    if (!row) throw new Error("no video row");
    const session: { user: { id: string } } = await (await apiFetch(cookie, "/api/auth/get-session")).json();
    return { row, userId: session.user.id, advert };
  }

  it("settles a job once when two checks race", async () => {
    const cookie = await readyUser();
    const { row, userId } = await pendingRow(cookie);
    const first = await refreshVideo(testEnv, userId, row);
    const second = await refreshVideo(testEnv, userId, row);
    expect(first.r2Key).not.toBeNull();
    expect(second.r2Key).toBe(first.r2Key);
    const listed = await testEnv.FILES.list({ prefix: `users/${userId}/posts/${row.advertId}/video-` });
    expect(listed.objects.filter((o) => o.key.endsWith(".mp4"))).toHaveLength(1);
  });

  it("gives up on a job that has run too long", async () => {
    const cookie = await readyUser();
    const { row, userId } = await pendingRow(cookie);
    const late = await refreshVideo(testEnv, userId, row, row.createdAt.getTime() + VIDEO_JOB_TTL_MS + 1);
    expect(late.status).toBe("failed");
    expect(await videosUsed(cookie)).toBe(0);
  });

  it("copes with the advert being deleted while the video was made", async () => {
    const cookie = await readyUser();
    const done = await pendingRow(cookie);
    await apiFetch(cookie, `/api/posts/${done.advert.id}`, { method: "DELETE" });
    expect((await refreshVideo(testEnv, done.userId, done.row)).status).toBe("pending");

    const failing = await pendingRow(cookie);
    await apiFetch(cookie, `/api/posts/${failing.advert.id}`, { method: "DELETE" });
    onFetch(JOB_URL, () => Response.json({ status: "failed" }));
    expect((await refreshVideo(testEnv, failing.userId, failing.row)).status).toBe("pending");
  });

  it("leaves a settled video alone", async () => {
    const cookie = await readyUser();
    const { row, userId } = await pendingRow(cookie);
    const ready = await refreshVideo(testEnv, userId, row);
    const calls = callsTo(JOB_URL).length;
    expect(await refreshVideo(testEnv, userId, ready)).toBe(ready);
    expect(callsTo(JOB_URL)).toHaveLength(calls);
  });
});
