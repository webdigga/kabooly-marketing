import type { Env } from "./env";
import {
  base64ToBytes,
  bytesToBase64,
  firstVideo,
  INTERACTIONS_URL,
  logoInput,
} from "./image-maker";
import type { InteractionResponse, Logo } from "./image-maker";
import type { Profile } from "./profile";

const TIMEOUT_MS = 60_000;
// A video job still unfinished after this is treated as failed.
export const VIDEO_JOB_TTL_MS = 20 * 60_000;

export class VideoError extends Error {}

export function videoPrompt(profile: Profile, topic: string, motion: string | null, hasLogo: boolean): string {
  const references = hasLogo
    ? "[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]"
    : "[# Sources <FIRST_FRAME>@Image1]";
  const lines = [
    references,
    `An 8 second vertical social media video advert for ${profile.businessName}, a small local business (${profile.description}).`,
    `The advert is about: ${topic}`,
    motion
      ? `Movement: ${motion}`
      : "Movement: bring the scene gently to life with natural motion and a slow, smooth camera move.",
    "Include calm background music that suits the business. No dialogue or voice-over.",
    "Do not add any words, captions, prices or other text.",
    "Use Image1 as the starting frame.",
  ];
  if (hasLogo) {
    lines.push(
      "Image2 is the business logo, already shown in the starting frame. Use it as a reference so the logo stays exactly as it is and is never redrawn or distorted."
    );
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
