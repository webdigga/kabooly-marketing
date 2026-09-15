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

// Answers topic requests and advert requests differently, the way the
// system prompts tell them apart.
export function mockClaude(advert = "Spring is here. Book your oven clean in Twickenham today.", topic = "Spring oven cleaning"): void {
  onFetch(ANTHROPIC_URL, async (req) => {
    const body: { system: string } = await req.json();
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

export function mockGemini(): void {
  onFetch(GEMINI_URL, () => Response.json(geminiImage()));
}
