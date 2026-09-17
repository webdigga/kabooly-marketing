# Kabooly Marketing

## 🔄 Active work

```
Stage:  LIVE with paid-only billing, 2026-09-16. Registration closed; only
        the founder login (webdigga42@gmail.com) works without a
        subscription. Secrets INTERNAL_API_SECRET and STRIPE_WEBHOOK_SECRET
        set; Stripe endpoint marketing.kabooly.com/api/stripe/webhook exists.
Built:  account emails now HTML with the shared Kabooly signature
        (src/email-layout.ts), not yet deployed. Deploy after kabooly.com,
        which serves the logo image.
Built:  self-service account deletion removed 2026-09-17 (Settings says
        "To cancel or delete your account, email hello@kabooly.com"; the
        Marketing privacy policy and terms on kabooly.com say the same). To
        delete an account by hand: delete the D1 user row (cascades) AND the
        R2 prefix users/{userId}/. Not yet deployed.
Spec:   docs/PLAN.md (full brief, decisions, open questions).
Don't:  add anything outside the brief (see "Explicitly out of scope").
```

## What this is
Standalone tool at marketing.kabooly.com that generates local adverts (text plus one image per ticked platform) for small businesses to post by hand on Instagram, Facebook and Nextdoor. Own login. Sold as one of three Kabooly products (Managed Website Service, Marketing, CRM), on its own or in the bundle, so linking to the CRM and the other products is allowed. Still technically separate from the CRM: no shared login, no dependency.

## Stack
- One Cloudflare Worker (`worker/`) serves the API (Hono, `/api/*`) AND the web app (Workers static assets from `frontend/dist`, SPA fallback). Same origin, so first-party cookies and no CORS.
- `frontend/`: React + Vite + TypeScript, CSS modules (plain CSS, no Tailwind), mobile first.
- Email: Cloudflare Email Sending via the `EMAIL` binding (`worker/src/email.ts`), sender in the `EMAIL_FROM` var. Set-password links for new customers, verification codes and password reset codes.
- D1 (`DB`) via drizzle; R2 (`FILES`) for logos and advert images; Cloudflare Images (`IMAGES`) crops Gemini output to exact platform sizes; Durable Object (`LIMITER`, one per account) for limits.
- Auth: better-auth, copied from TrackShows (email + password, 6-digit emailOTP codes for verification and reset, Google, account linking). Unlike TrackShows, the server enforces verification on every app route (`worker/src/session.ts`).
- Claude Haiku 4.5 (`claude-haiku-4-5`) for text and topic suggestions; Gemini image API (Interactions endpoint, model in `GEMINI_IMAGE_MODEL`) for images.

## Map
- `worker/src/index.ts` routes; `auth.ts`; `session.ts` (verified-user gate); `profile.ts` (profile + website scan route); `scan/` (colour + logo detection); `files.ts` (logo upload, owner-only file serving); `adverts.ts` (topics, generations, library, regeneration, usage); `generation.ts` (NDJSON stream, runs under waitUntil); `copywriter.ts` (Haiku); `image-maker.ts` (Gemini + crop); `limiter.ts` (Durable Object) and `limits.ts` (429 responses).
- `frontend/src/App.tsx` routes and guards; `pages/` (SignIn, VerifyEmail, ForgotPassword, Onboarding, Generator, Library grid, LibraryItem detail + delete, Settings); `profile/` (draft, fields, website scan hook); `components/` shared UI (Button, Card, Field, Alert, ImageTile, AdvertText...).

## Hard rules
- Follow the TrackShows auth pattern. Do not invent a new auth approach.
- Out of scope: auto-posting, posting tips/scheduling/calendars, any shared login or dependency on the CRM, multiple text variations, any cancellation or billing screen (cancellation is manual, by email).
- Paid accounts only (added 2026-09-16). Nobody can register: email sign-up, sign-in codes and Google are all set to `disableSignUp`. Accounts are created only by `POST /api/internal/provision`, called by the kabooly.com checkout after payment, which emails a 7 day set-password link (`/set-password?token=`). Checkout never sends a password.
- Access = a `subscriptions` row with `active = true`, checked in `session.ts` (402 `SUBSCRIPTION_INACTIVE`). The founder's account (`FOUNDER_LOGIN_EMAIL`, webdigga42@gmail.com) works without one. `source = marketing` rows follow this worker's Stripe webhook (`/api/stripe/webhook`, metadata `plan=marketing`); `source = bundle` rows are switched by the CRM webhook through `POST /api/internal/bundle-access`.
- `/api/internal/*` is server-to-server only: `Authorization: Bearer INTERNAL_API_SECRET`.
- Limits live only in `worker/src/limiter.ts` (`LIMITS`): 20 images per rolling 24h, 5 image generations per minute, one generation in flight (topic suggestions exempt from the lock), text 200/day and 20/min. Regenerations count.
- Schema changes go through `npm run db:generate` in `worker/` (drizzle-kit); never hand-edit an applied migration.
- Worker: strict ESLint (TrackShows config) and 100% coverage (`npm run test:coverage`). Frontend: `npm run lint` at 0 warnings, tests with data-testid or role selectors.
- Use the shared components (`Card`, `Button`/`buttonClass`, `Field`, `Alert`) rather than local recipes.
- Mobile-first CSS: `min-width` media queries only. Palette and font come from the kabooly.com marketing site (`frontend/src/styles/variables.css`).
- No en or em dashes in any copy.
- Do not run Playwright on small UI changes.
- David runs all git, wrangler and deploy commands, and the dev servers.

## Commands
- `worker/`: `npm test`, `npm run test:coverage`, `npm run lint`, `npm run typecheck`, `npm run db:generate`, `npm run db:migrate:local`.
- `frontend/`: `npm run dev` (proxies `/api` to `wrangler dev` on 8787), `npm run build`, `npm run lint`, `npm run test:run`.
- Local: copy `worker/.dev.vars.example` to `.dev.vars`, `npm run db:migrate:local`, then `npx wrangler dev` in `worker/` and `npm run dev` in `frontend/`; open http://localhost:5173.
- Deploy: automatic on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`): lint and tests for both packages, then `npm run deploy` in `worker/` (builds the frontend, applies D1 migrations, deploys). A red run deploys nothing. Needs repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. David pushes manually.

## Gotchas
- Never put "advert", "ads" or "banner" in a URL, R2 key, DOM id or test id: ad blockers block or hide them (found live 2026-09-15, images failed with ERR_BLOCKED_BY_CLIENT). Saved adverts are `/api/posts` and `users/{id}/posts/...` in R2. User-facing copy can still say "advert".
- npm 11.5.1 crashes (`reading 'edgesOut'`) when resolving vitest: vite 8.3's optional `@vitejs/devtools` peer pulls vitest 5 against the pool's vitest 4 pin. Lockfiles are fine for `npm ci`; to add packages use `npx npm@latest install`.
- Local workerd only supports compatibility dates up to 2026-08-22, hence `2026-08-15` in wrangler.toml.
- Test mocks for the better-auth client live in `frontend/test/auth-mock.ts` and must not import the app (a `vi.mock` factory importing `helpers.tsx` deadlocks).
- SVG logos are converted to PNG in the browser (`frontend/src/lib/svg-to-png.ts`) because Gemini needs raster input; the Worker only ever stores PNG, JPEG or WebP.
