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

## Built 2026-09-17: usage caps, videos, photo posts, carousels, website fill

Agreed with David 2026-09-17 and built the same day. Not yet deployed or tested live. What to check live, in order:

1. Website fill: onboarding step 1 on a real site fills name, description, services, audience, area, tone, colours and logo; Settings "Refetch" highlights changes and saves only on Save.
2. Usage panel shows images today (20), this month (150) and videos this month (20).
3. Post from your own photo: the Images binding's logo strip (`brandPhoto`) only ran against the local emulator, so check the logo and brand-coloured edge look right on all three sizes.
4. Carousel: slides render with background, logo and colour; "Download all slides" saves five 1080x1350 PNGs.
5. Video: made from the create screen and from a library advert; plays on an iPhone (needs the byte-range support added to `/api/files`); download works; the job disappears from Google AI Studio logs once saved.

## Decisions

- Monthly caps (2026-09-17): 150 images per rolling 30 days on top of 20 per 24 hours, and 20 videos per rolling 30 days, all in the `LIMITER` Durable Object, which now keeps 30 days of events. At about 10.5p an image and about 75p a video, the worst case is about £31 a month per account. A carousel counts as one image; own-photo posts and website reads count only as text. Regenerations count; failures are refunded.
- Videos (2026-09-17): Gemini Omni Flash (`GEMINI_VIDEO_MODEL = "gemini-omni-1.1-flash"`), chosen over Veo 3.1 Fast (same price, same Interactions API as images). Output is 9:16 at 720p, up to 10 seconds: 1080p is only an upscale of the same 720p and two test videos at 1080p cost about £1 each against the 75p Google's 720p rate implies (David, 2026-09-18). Gemini first draws a 9:16 starting image with the logo, exactly like the platform images; Omni animates it with the logo attached as a reference. Since 2026-09-17 (David, after a first video of a woman breathing that nobody could use): Haiku first plans a 10 second captioned advert as a forced tool call (a hook shot, two shots of the work or result, an end card with the business name and a closing caption, plus music), avoiding faces and subtle body movement, which AI video renders robotically. The starting image is the hook scene, and Omni films the plan as a timecoded prompt with the captions written in. The customer's optional box is "What should the video show?". Longer videos would need 10 second extensions, each costing about the same again. Background mode needs Google to store the job (`store: false` is not allowed), so the job is deleted from Google once the video is saved. The app checks on a pending video every 10 seconds; a job still unfinished after 20 minutes is marked failed and refunded. Rejected: stamping the logo on afterwards with Cloudflare Stream or an ffmpeg container (extra moving parts; the business name and picture already show on every Reel).
- A video made from the create screen is saved as an image-free advert with a video, so any advert in the library can also get a video.
- Branding on images (2026-09-18, David: "there is nothing to pay for" while Gemini drew the logo itself, poorly): Gemini is never asked to draw the logo. When the profile is saved, the browser draws one brand strip per platform (the real logo file hard left and the website address hard right, on a bar in the first brand colour, at that platform's exact width and 9% of it in height) and uploads them; `business_profiles.brand_strips` holds the keys, and Cloudflare Images draws the matching one flush along the bottom of every generated image and every own-photo image. One strip stretched to every size (2026-09-18) letterboxed on the wide Facebook image, hence one per platform. The Images binding's `text()` tool would have done the words server side, but the local emulator has no `text()`, so it could not be tested. Videos carry no logo either: the end card says the business name instead.
- Own-photo posts (2026-09-17): upload rules are JPEG, PNG or WebP, at least 1200 pixels on the shortest side, up to 20 MB, checked in the browser and again by the Worker. HEIC is not accepted: iPhones convert to JPEG when a photo is picked in the browser. One pending upload per account; the photo is deleted once its platform images are cut, so own-photo images cannot be regenerated. Cloudflare Images crops with `gravity: auto` and stamps the same brand strip on.
- Carousels (2026-09-17): five slides at 1080x1350. Haiku writes them through a forced tool call (checked with zod); Gemini makes one logo-free 4:5 background. The browser draws the finished slides on a canvas at download time, so the words stay editable and the logo is the real file.
- Instagram Stories (2026-09-18): a fourth platform, 1080x1920, ticked on the Image advert and Photo post pages (off by default: a Story lasts 24 hours). Gemini makes a full screen photograph with the top and bottom quarters kept clear, Haiku writes a headline and a call to action (`adverts.story_words`), and the browser draws those words, the logo and the button over the photo when the Story is shown or downloaded, clear of Instagram's own controls (250px top and bottom). No brand strip: the logo is drawn in the overlay instead.
- Website fill (2026-09-17): the scan also reads the words of the home page and up to two pages found from its links (services first, then about, then products or prices) and Haiku fills in the profile through a forced tool call. Any failure leaves those fields empty.
- `/api/files` honours byte ranges (206), because iPhones will not play a video without them.
- Schema change for these features adds columns with ALTER TABLE only. drizzle-kit wanted to rebuild `adverts` for a CHECK on `format`; on D1 that drop would cascade-delete `advert_images`, so there is no CHECK on `format`.

- One Worker serves app and API on one origin (Workers static assets, `run_worker_first = ["/api/*"]`). TrackShows and the CRM both split a Pages frontend from an API subdomain; that split exists there for native apps and cross-domain reasons that do not apply here.
- Frontend is React + Vite + TypeScript with plain CSS files, matching the CRM frontend.
- Worker uses Hono (brief + TrackShows). The CRM worker uses a hand-rolled route table instead; not followed here because the auth pattern being copied is Hono-based.
- Schema: `business_profiles` (one row per account; its existence marks onboarding done), `profile_services` (one row per service, ordered), `adverts`, `advert_images` (one per platform per advert, regenerate replaces). Audience and local area are two separate columns. Tone is 1 (formal) to 5 (casual). Brand colours are a JSON list of hex strings. Logo is an R2 key.
- Limits: one Durable Object per account (the CRM uses a DO for atomic rate limits too). It holds the in-flight lock (5 minute safety expiry), the per-minute windows and the rolling 24 hour and 30 day counts. Images are counted when a generation starts and failed ones refunded when it finishes, so abandoning a generation cannot dodge the cap. Text-only work (topic suggestions, text regeneration, image-free adverts) has its own cap: 200 a day, 20 a minute (confirmed by David 2026-09-16). Every generation respects the one-in-flight lock except topic suggestions, which only count towards the text caps (changed 2026-09-15: the landing-page suggestion was being refused as "busy" while another tab was generating).
- A generation is one request that streams newline-delimited JSON: the advert text (saved to the library the moment it exists), then each image as it lands. Images are made one at a time, with one automatic retry each (2026-09-18: three at once kept failing, and a retry costs nothing when the first attempt made nothing). It runs under waitUntil, so closing the tab still finishes and saves it.
- Images: Gemini draws 1:1 (Instagram, Nextdoor) or 16:9 (Facebook) at 2K, then Cloudflare Images crops to exactly 1080x1080, 1200x630 and 1200x1200 JPEG. Model `gemini-3-pro-image` (Nano Banana Pro) at 2K since 2026-09-17, switched from `gemini-3.1-flash-image` by David after poor first results (an extra arm, a fudged logo); allowances unchanged. 2K, not 1K: 1K would mean upscaling the 1200px sizes by about 17%. The model is the `GEMINI_IMAGE_MODEL` var; the size is in `image-maker.ts`. About 10.5p an image ($0.134 at 2K, Google price list checked 2026-09-17). Interactions are sent with `store: false`.
- Email: Cloudflare Email Sending (beta, Workers Paid) through the `EMAIL` binding, not Resend (David, 2026-09-15). Sender is `noreply@marketing.kabooly.com` (display name "Kabooly Marketing" set in code): marketing.kabooly.com is onboarded as its own sending domain so nothing touches kabooly.com's IONOS mail records (MX, SPF, DMARC p=quarantine) or the CRM's Resend domain mail.kabooly.com.
- Signup alerts: removed 2026-09-16 when registration closed. Accounts are now created only by the kabooly.com checkout, and `FOUNDER_LOGIN_EMAIL` (webdigga42@gmail.com) marks the founder's account, which needs no subscription.
- Email verification is enforced by the server on every app route. TrackShows only gates it in the client because of old native builds; this app has none.
- Website scan: fetches the page (8s timeout, size caps), reads theme-color, CSS (inline and up to three stylesheets) and brand-named custom properties for colours, and ranks logo candidates (logo-marked images in the header first, then icons). SVG logos go back to the browser, which converts them to PNG. Any failure falls back to manual entry.
- Google OAuth brand verification: done 2026-09-15, re-verified 2026-09-16 with the marketing privacy policy and terms links.
- Billing accounts: only "My Billing Account 1" exists (checked 2026-09-16); the second one AI Studio listed on 2026-09-15 was a stale entry, so there is nothing to close.
- Legal pages live on the marketing site (`kabooly/src/pages/marketing-privacy-policy.astro` and `marketing-terms-of-service.astro`), linked from its footer and from the app sign-in screens. KABOOLY LTD is the controller; contact privacy@kabooly.com.
- Palette and font: the kabooly.com marketing site (light, blue #1d4ed8, Inter), not the CRM (dark, indigo, Mona Sans). Settled by David 2026-09-16: it matches where customers arrive from, and a light background suits judging advert images.
- Website scan is rate limited (2026-09-16): it counts against the same text allowance as topic suggestions (200 a day, 20 a minute) and takes no in-flight lock. The app shows "Wait a minute and try again" when it bites.
- Logo files: saving the profile deletes every other logo file under the account's prefix, so replaced logos and ones a scan stored but the user never kept do not pile up (2026-09-16). No R2 lifecycle rule needed.
- Account deletion: no self-service button (removed 2026-09-17, so a paying customer cannot delete while Stripe keeps charging). Customers email hello@kabooly.com; David cancels the subscription, deletes the D1 user row (the cascade takes the profile, services, adverts and image rows) and empties the R2 prefix `users/{userId}/`. The legal pages say the same.
- Library (changed after first live test, 2026-09-15): a compact grid of cards (square thumbnail, or the text for image-free adverts; topic; date; platforms). Each opens `/library/:id` with the full text, copy, downloads and Delete (asks once more; removes the row, image rows and R2 files via `DELETE /api/posts/:id`).
- Platforms: all three are ticked by default; the last choice is remembered per browser.

## Needs doing before real users

- The Gemini billing account is on Prepay: images need a prepaid balance (minimum $5, AI Studio > Billing > Buy credits), and the Ultra Cloud credit is only used once a prepaid balance exists (it is spent first). At $0 prepaid, every image fails with a 429 "prepayment credits are depleted". Prepay cannot be switched to postpay.

- Gemini API spend cap is £29 a month on the Kabooly Marketing Google Cloud project (raised from £10 on 2026-09-16 to match the Google AI Ultra credit of $40, about £29, claimed 2026-09-15). The cap counts usage even though the credit pays the bill, so it only bites once the free credit is used up. At roughly 10.5p an image that is about 280 images a month; videos (about 75p each, plus 10.5p for the starting image) share the same cap. It covers all customers together, so it needs raising as customers sign up.

- Cloudflare Images free plan covers 5,000 unique transformations a month (one per advert image). Beyond that, new crops fail with error 9422 until Images is upgraded to paid ($0.50 per 1,000). Watch usage once real accounts arrive.

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
