import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import type { Profile } from "./profile";

const MODEL = "claude-haiku-4-5";

export class CopyError extends Error {}

// Tone runs 1 (formal) to 5 (casual), as set in the business profile.
export function toneGuide(tone: number): string {
  if (tone <= 1) return "Formal: polished and professional. No slang, no emoji.";
  if (tone === 2) return "Professional but warm. No emoji.";
  if (tone === 3) return "Friendly and conversational. At most one emoji.";
  if (tone === 4) return "Casual and upbeat. A couple of emoji are fine.";
  return "Very casual and playful. Emoji welcome.";
}

function client(env: Env): Anthropic {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 60_000,
    // Late-bound so the global fetch is looked up per call.
    fetch: (input, init) => fetch(input, init),
  });
}

export function describeBusiness(profile: Profile): string {
  const lines = [
    `Business name: ${profile.businessName}`,
    `What the business does: ${profile.description}`,
    `Services or products: ${profile.services.join("; ")}`,
    `Target audience: ${profile.targetAudience}`,
    `Local area: ${profile.localArea}`,
  ];
  if (profile.websiteUrl) lines.push(`Website: ${profile.websiteUrl}`);
  return `<business>\n${lines.join("\n")}\n</business>`;
}

function today(): string {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function complete(env: Env, system: string, prompt: string, maxTokens: number) {
  let response: Anthropic.Message;
  try {
    response = await client(env).messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.error("Anthropic request failed", err);
    throw new CopyError("Text generation failed");
  }
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  if (response.stop_reason === "refusal" || !text) {
    throw new CopyError("Text generation returned nothing usable");
  }
  return text;
}

const TOPIC_SYSTEM = `You suggest advert topics for small local businesses that post by hand on Instagram, Facebook and Nextdoor.
Reply with one topic only: a short phrase under 12 words, no quotes, no full stop, no preamble.
Use UK English spelling (organise, colour, favourite, centre).
Base it on one of the business's services or products and, where it fits naturally, the time of year.
Never invent offers, prices, discounts or events the business has not mentioned.`;

export async function suggestTopic(env: Env, profile: Profile, avoid: string[]): Promise<string> {
  const avoidList = avoid.length
    ? `\n\nDo not repeat or closely echo these earlier suggestions:\n${avoid.map((t) => `- ${t}`).join("\n")}`
    : "";
  const prompt = `${describeBusiness(profile)}\n\nToday is ${today()}. Suggest one advert topic.${avoidList}`;
  const topic = await complete(env, TOPIC_SYSTEM, prompt, 100);
  return topic.split("\n", 1).join("").replace(/^["'\s]+|["'.\s]+$/g, "");
}

const ADVERT_SYSTEM = `You write local adverts for small businesses, posted by hand on Instagram, Facebook and Nextdoor.
Write one block of advert text that works on all three platforms:
- 50 to 120 words, plain text, no markdown, no headings, no hashtags.
- UK English spelling and vocabulary (organise, colour, favourite, centre), never American spelling.
- Speak to the target audience and mention the local area naturally.
- End with a clear, simple call to action (the website if one is given, otherwise getting in touch).
- Never invent prices, offers, discounts, phone numbers, awards or claims the business has not given.
Reply with the advert text only.`;

export async function writeAdvert(env: Env, profile: Profile, topic: string): Promise<string> {
  const prompt = `${describeBusiness(profile)}\n\nTone of voice: ${toneGuide(profile.tone)}\n\nAdvert topic: ${topic}`;
  return complete(env, ADVERT_SYSTEM, prompt, 1024);
}
