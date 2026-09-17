import type { Env } from "./env";
import {
  base64ToBytes,
  bytesToBase64,
  firstVideo,
  INTERACTIONS_URL,
  logoInput,
} from "./image-maker";
import type { InteractionResponse, Logo } from "./image-maker";
import type { VideoPlan, VideoShot } from "./copywriter";
import type { Profile } from "./profile";

const TIMEOUT_MS = 60_000;
// A video job still unfinished after this is treated as failed.
export const VIDEO_JOB_TTL_MS = 20 * 60_000;

export class VideoError extends Error {}

function onScreen(caption: string): string {
  return `On screen, the words "${caption}" in large, bold, clean white letters with a soft shadow, centred in the upper third, spelt exactly as written.`;
}

// The timecoded prompt Omni films: the planned shots, their captions and an
// end card with the business name.
export function videoPrompt(profile: Profile, plan: VideoPlan, hasLogo: boolean): string {
  const references = hasLogo
    ? "[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]"
    : "[# Sources <FIRST_FRAME>@Image1]";
  // The plan's schema guarantees exactly two middle shots.
  const [second, third] = plan.middle as [VideoShot, VideoShot];
  const lines = [
    references,
    `A 10 second vertical social media video advert for ${profile.businessName}, a small local business (${profile.description}). Quick, confident editing with clean cuts.`,
    `[0-3s] ${plan.hook.scene} ${onScreen(plan.hook.caption)}`,
    `[3-5s] Cut to: ${second.scene} ${onScreen(second.caption)}`,
    `[5-7s] Cut to: ${third.scene} ${onScreen(third.caption)}`,
    `[7-10s] Cut to an end card: a clean, simple background. In the centre, "${profile.businessName}" in large bold letters, and below it "${plan.endCaption}" in smaller letters, both spelt exactly as written.`,
    `Audio: ${plan.music}. No dialogue, voice-over or singing.`,
    "Any people move naturally and are anatomically correct. No text other than the words given above.",
    "Use Image1 as the starting frame.",
  ];
  if (hasLogo) {
    lines.push("Image2 is the business logo, already in the starting frame. Use it as a reference so it is never redrawn or distorted.");
  }
  return lines.join("\n");
}

function headers(env: Env): Record<string, string> {
  return { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" };
}

async function call(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err: unknown) => {
    throw new VideoError(`Gemini request failed: ${String(err)}`);
  });
  if (!res.ok) {
    throw new VideoError(`Gemini returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

// Starts a video in Google's background mode and returns the job's id.
// Background jobs must be stored by Google, so the job is deleted once the
// video has been collected (see deleteVideoJob).
export async function startVideo(
  env: Env,
  startImage: Uint8Array,
  logo: Logo | null,
  prompt: string
): Promise<string> {
  const input: Record<string, string>[] = [
    { type: "image", mime_type: "image/jpeg", data: bytesToBase64(startImage) },
  ];
  if (logo) input.push(logoInput(logo));
  input.push({ type: "text", text: prompt });
  const res = await call(INTERACTIONS_URL, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      model: env.GEMINI_VIDEO_MODEL,
      input,
      response_format: { type: "video", aspect_ratio: "9:16", resolution: "1080p" },
      background: true,
    }),
  });
  const body: InteractionResponse = await res.json();
  if (!body.id) throw new VideoError("Gemini returned no job id");
  return body.id;
}

export type VideoJob =
  | { state: "running" }
  | { state: "failed"; reason: string }
  | { state: "done"; bytes: Uint8Array };

async function collect(env: Env, body: InteractionResponse): Promise<VideoJob> {
  const video = firstVideo(body);
  if (video?.data) return { state: "done", bytes: base64ToBytes(video.data) };
  if (video?.uri) {
    const res = await call(video.uri, { headers: headers(env) });
    return { state: "done", bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  return { state: "failed", reason: "completed without a video" };
}

// Asks Google how a background video job is getting on.
export async function checkVideo(env: Env, interactionId: string): Promise<VideoJob> {
  const res = await call(`${INTERACTIONS_URL}/${encodeURIComponent(interactionId)}`, { headers: headers(env) });
  const body: InteractionResponse = await res.json();
  if (body.status === "completed") return collect(env, body);
  if (body.status === "in_progress" || body.status === undefined) return { state: "running" };
  return { state: "failed", reason: `job ${body.status}` };
}

// Removes the stored job from Google once its video is saved. Best effort:
// Google deletes stored interactions on its own schedule anyway.
export async function deleteVideoJob(env: Env, interactionId: string): Promise<void> {
  try {
    await call(`${INTERACTIONS_URL}/${encodeURIComponent(interactionId)}`, {
      method: "DELETE",
      headers: headers(env),
    });
  } catch (err) {
    console.error("could not delete video job", err);
  }
}
