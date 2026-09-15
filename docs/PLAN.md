# Kabooly Marketing: build plan

## Stages

All built 2026-09-15 (David asked for stages 2 to 8 to run without stopping, questions at the end).

1. DONE. Project skeleton, Hono routes, D1 schema, R2 binding.
2. DONE. Auth: registration, verification, Google sign-in, sessions, password reset.
3. DONE. Onboarding flow and business profile, website fetch for colours and logo, settings screen.
4. DONE. Text generation with Haiku, topic suggestion and editing.
5. DONE. Image generation with Gemini, platform selection, per-image regeneration.
6. DONE. Library, R2 storage and retrieval.
7. DONE. Rate limits and daily cap.
8. DONE. Kabooly branding throughout; live and tested end to end by David on 2026-09-15.

## Decisions

- One Worker serves app and API on one origin (Workers static assets, `run_worker_first = ["/api/*"]`). TrackShows and the CRM both split a Pages frontend from an API subdomain; that split exists there for native apps and cross-domain reasons that do not apply here.
- Frontend is React + Vite + TypeScript with plain CSS files, matching the CRM frontend.
- Worker uses Hono (brief + TrackShows). The CRM worker uses a hand-rolled route table instead; not followed here because the auth pattern being copied is Hono-based.
- Schema: `business_profiles` (one row per account; its existence marks onboarding done), `profile_services` (one row per service, ordered), `adverts`, `advert_images` (one per platform per advert, regenerate replaces). Audience and local area are two separate columns. Tone is 1 (formal) to 5 (casual). Brand colours are a JSON list of hex strings. Logo is an R2 key.
- Limits: one Durable Object per account (the CRM uses a DO for atomic rate limits too). It holds the in-flight lock (5 minute safety expiry), the per-minute window and the rolling 24 hour image count. Images are counted when a generation starts and failed ones refunded when it finishes, so abandoning a generation cannot dodge the cap. Text-only work (topic suggestions, text regeneration, image-free adverts) has its own cap: 200 a day, 20 a minute. Every generation respects the one-in-flight lock except topic suggestions, which only count towards the text caps (changed 2026-09-15: the landing-page suggestion was being refused as "busy" while another tab was generating).
- A generation is one request that streams newline-delimited JSON: the advert text (saved to the library the moment it exists), then each image as it lands. It runs under waitUntil, so closing the tab still finishes and saves it.
- Images: Gemini draws 1:1 (Instagram, Nextdoor) or 16:9 (Facebook) at 2K, then Cloudflare Images crops to exactly 1080x1080, 1200x630 and 1200x1200 JPEG. Interactions are sent with `store: false`.
- Email: Cloudflare Email Sending (beta, Workers Paid) through the `EMAIL` binding, not Resend (David, 2026-09-15). Only the verification and password reset codes are sent. Sender is `noreply@marketing.kabooly.com` (display name "Kabooly Marketing" set in code): marketing.kabooly.com is onboarded as its own sending domain so nothing touches kabooly.com's IONOS mail records (MX, SPF, DMARC p=quarantine) or the CRM's Resend domain mail.kabooly.com.
- Email verification is enforced by the server on every app route. TrackShows only gates it in the client because of old native builds; this app has none.
- Website scan: fetches the page (8s timeout, size caps), reads theme-color, CSS (inline and up to three stylesheets) and brand-named custom properties for colours, and ranks logo candidates (logo-marked images in the header first, then icons). SVG logos go back to the browser, which converts them to PNG. Any failure falls back to manual entry.
- Palette and font: the kabooly.com marketing site (light, blue #1d4ed8, Inter), not the CRM (dark, indigo, Mona Sans). Open question below.
- Library (changed after first live test, 2026-09-15): a compact grid of cards (square thumbnail, or the text for image-free adverts; topic; date; platforms). Each opens `/library/:id` with the full text, copy, downloads and Delete (asks once more; removes the row, image rows and R2 files via `DELETE /api/posts/:id`).
- Platforms: all three are ticked by default; the last choice is remembered per browser.

## Open questions for David

- Palette: marketing site look (used) or the CRM's dark theme?
- Text caps: 200 a day and 20 a minute.
- Gemini model and size: `gemini-3.1-flash-image` at 2K (the `GEMINI_IMAGE_MODEL` var switches model without code).

## Needs doing before real users

- Google OAuth brand verification: re-run "Verify branding" on the Branding page once marketing.kabooly.com is deployed (it failed 2026-09-15 only because the home page was not live yet). Google sign-in works meanwhile; the consent screen just does not show the app name.

- A privacy policy and terms of service written for this tool. The Google OAuth branding (project "Kabooly Marketing", created 2026-09-15) points at the general https://kabooly.com/privacy-policy/ for now, and has no terms link; the only kabooly.com terms page is the CRM's.

- The Gemini billing account is on Prepay: images need a prepaid balance (minimum $5, AI Studio > Billing > Buy credits), and the Ultra Cloud credit is only used once a prepaid balance exists (it is spent first). At $0 prepaid, every image fails with a 429 "prepayment credits are depleted". Prepay cannot be switched to postpay.

- Gemini API spend cap is £10 a month on the Kabooly Marketing Google Cloud project (set 2026-09-15, billing on). Raise it before real customers arrive: it stops all image generation when hit. Google does not document whether the cap counts usage before or after credits; David's Google AI Ultra plan gives a Google Developer Program credit of $40 a month (about £29), claimed 2026-09-15 on the project's billing account, which pays for the usage.

- Cloudflare Images free plan covers 5,000 unique transformations a month (one per advert image). Beyond that, new crops fail with error 9422 until Images is upgraded to paid ($0.50 per 1,000). Watch usage once real accounts arrive.

## Not built (outside the brief, flagged only)

- Account deletion.
- Clean-up of R2 files nothing points to (logos uploaded but never saved). An R2 lifecycle rule would cover it.
- The website scan is not rate limited.

## Brief

### What this is
A standalone marketing tool that generates local adverts (text plus image) for small businesses to post by hand on Instagram, Facebook and Nextdoor. It is its own product with its own URL and its own login. It is not part of the Kabooly CRM, shares no login with it, and adds nothing to the CRM interface. Billing and Stripe are out of scope for this build. Assume every registered account has full access for now.

### Stack
Cloudflare Workers with Hono for routing. Cloudflare D1 for data (not Supabase). Cloudflare R2 for generated images. Vanilla CSS (not Tailwind). Anthropic API, Claude Haiku 4.5, for advert text. Google Gemini image API for advert images.

### Auth
Registration by email and password, with an email verification step. Google sign-in as an alternative. Follow the TrackShows implementation of both. Standard session handling, password reset, sign out.

### Onboarding
Signup collects email and password only. On first login after verification, run a one-time onboarding flow that collects the business profile. The profile is editable at any time afterwards from a settings screen.

Business profile fields: business name; what the business does (free text); website URL; target audience and local area; tone of voice (formal through to casual); services or products (a list, added as separate items); brand colours; logo.

Auto-fill from the website: when the user enters their website URL, fetch the site and derive the brand colours (by inspecting the site) and the logo (by locating it on the site). Present both as pre-filled values the user can accept or change. Colours must be editable manually. The logo must be replaceable by upload if the detected one is wrong or missing. Never block onboarding on a failed fetch, fall back to manual entry.

### The generator (main screen)
Topic: on landing, the tool suggests an advert topic derived from the business profile and the services list. The user can accept it, type their own, or ask for a different suggestion.

Platform selection: the user ticks which platforms they want images for; only ticked platforms generate an image. Instagram square 1080 x 1080; Facebook landscape 1200 x 630; Nextdoor square 1200 x 1200. Each generated image is labelled with its platform.

Generation: one advert per generation, producing one block of advert text and one image per ticked platform.
- Text: written by Claude Haiku 4.5; uses what they do, services, audience and area, tone; editable in place after generation; can be regenerated.
- Images: generated by the Gemini image API; incorporate the business logo and brand colours where it can; each can be regenerated individually without regenerating the text or the other platforms' images.

Output: copy button for the text, download button for each image, every generated advert saved to the library automatically.

### Library
Previously generated adverts, newest first. Each entry shows the text and its images, with the same copy and download actions. Images are stored in and served from R2.

### Limits (both server side)
1. Hard cap of 20 image generations per account per rolling 24 hours. When hit, show a clear message explaining the daily limit and when it resets.
2. Rate limit: no more than 5 generations per minute per account, and only one generation in flight per account at a time.

Regenerations count towards both limits. Text-only generations are cheap: cap them generously, but do cap them.

### Look and feel
Existing Kabooly logo, fonts and colour palette. Layout need not match the CRM or marketing site. Clean and simple, one job.

### Explicitly out of scope
Automatic posting to any platform; posting tips, best-time-to-post advice, scheduling or calendars; any link to or dependency on the Kabooly CRM; Stripe, billing, plans or subscriptions; multiple text variations per generation.

### Notes
Do not run Playwright on small UI changes. Flag anything unexpected rather than silently fixing it. Prefer targeted edits over wholesale rewrites.
