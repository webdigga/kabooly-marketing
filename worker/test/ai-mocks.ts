import { onFetch } from "./fetch-mock";
import { PNG_BASE64 } from "./helpers";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export function claudeMessage(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: text ? [{ type: "text", text }] : [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

export function claudeToolCall(name: string, input: unknown) {
  return {
    ...claudeMessage(""),
    content: [{ type: "tool_use", id: "toolu_test", name, input }],
    stop_reason: "tool_use",
  };
}

export const SLIDES = [
  { heading: "Is your oven hiding grime?", body: "Swipe for the signs." },
  { heading: "Smoke when you cook", body: "Old grease burns every time the oven heats up." },
  { heading: "Food tastes of last week", body: "Baked-on residue carries flavours between dishes." },
  { heading: "The door will not come clean", body: "Glass cleaners cannot shift carbonised fat." },
  { heading: "Book a deep clean", body: "Visit acme-cleaning.co.uk to book in Twickenham." },
];

export const VIDEO_PLAN = {
  hook: { scene: "Slow push in on a greasy oven door in a bright kitchen.", caption: "Dreading your oven?" },
  middle: [
    { scene: "Gloved hands wipe the oven glass clean.", caption: "We deep clean it" },
    { scene: "Pan across the sparkling finished oven.", caption: "Like new again" },
  ],
  endCaption: "Book your clean today",
  music: "upbeat acoustic guitar",
};

export const STORY_WORDS = { headline: "Dreading your oven?", cta: "Book at acme.co.uk" };

export const DETAILS = {
  businessName: "Acme Cleaning",
  description: "We clean homes and ovens.",
  services: ["Oven cleaning", "Carpet cleaning"],
  targetAudience: "Busy families",
  localArea: "Twickenham",
  tone: 3,
};

interface ClaudeRequest {
  system: string;
  tools?: { name: string }[];
}

// Answers the way each prompt expects: topics and adverts as text, carousel
// slides and website profile reads as a call to their tool.
export function mockClaude(advert = "Spring is here. Book your oven clean in Twickenham today.", topic = "Spring oven cleaning"): void {
  onFetch(ANTHROPIC_URL, async (req) => {
    const body: ClaudeRequest = await req.json();
    const tool = body.tools?.[0]?.name;
    if (tool === "record_slides") return Response.json(claudeToolCall(tool, { slides: SLIDES }));
    if (tool === "record_profile") return Response.json(claudeToolCall(tool, DETAILS));
    if (tool === "record_video_plan") return Response.json(claudeToolCall(tool, VIDEO_PLAN));
    if (tool === "record_story_words") return Response.json(claudeToolCall(tool, STORY_WORDS));
    return Response.json(claudeMessage(body.system.includes("advert topics") ? topic : advert));
  });
}

export function geminiImage(data = PNG_BASE64) {
  return {
    id: "v1_test",
    status: "completed",
    steps: [
      { type: "thought", content: [{ type: "text", text: "thinking" }] },
      { type: "model_output", content: [{ type: "text", text: "Here it is" }, { type: "image", mime_type: "image/jpeg", data }] },
    ],
  };
}

export const MP4_BYTES = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

export function geminiVideo(status = "completed", content: Record<string, string> = { data: btoa(String.fromCharCode(...MP4_BYTES)) }) {
  return {
    id: "v1_video",
    status,
    steps: status === "completed" ? [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", ...content }] }] : [],
  };
}

// Images answer at once; a video request answers with a background job id,
// and checking the job finds it finished.
export function mockGemini(): void {
  onFetch(GEMINI_URL, async (req) => {
    if (req.method === "GET") return Response.json(geminiVideo());
    if (req.method === "DELETE") return Response.json({});
    const body: { background?: boolean } = await req.json();
    if (body.background) return Response.json({ id: "v1_video", status: "in_progress" });
    return Response.json(geminiImage());
  });
}
