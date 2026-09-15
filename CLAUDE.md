# Kabooly Marketing

## 🔄 Active work

```
Stage:  1 of 8 DONE 2026-09-15 (skeleton, Hono, D1 schema, R2 binding).
        Waiting on David to confirm before stage 2 (auth).
Next:   Stage 2, auth: better-auth exactly as TrackShows (onnext/worker/src/auth.ts).
Needs:  Domain for the app (BETTER_AUTH_URL + Google redirect URI).
        D1 database id (wrangler.toml has no database_id yet).
Spec:   docs/PLAN.md (full brief, stage list, decisions). Stop after every stage.
```

## What this is
Standalone tool that generates local adverts (text plus one image per ticked platform) for small businesses to post by hand on Instagram, Facebook and Nextdoor. Own URL, own login. NOT part of the Kabooly CRM: no shared login, no link, no dependency.

## Stack
- One Cloudflare Worker (`worker/`) serves the API (Hono, `/api/*`) AND the web app (Workers static assets from `frontend/dist`, SPA fallback). Same origin, so first-party cookies and no CORS.
- `frontend/`: React + Vite + TypeScript, vanilla CSS (no Tailwind).
- D1 (`DB`) via drizzle, R2 (`IMAGES`) for generated images and logos.
- Auth: better-auth, copied from TrackShows (email + password with emailOTP verification and reset, Google, account linking).
- Claude Haiku 4.5 for text, Gemini image API for images.

## Hard rules
- Follow the TrackShows auth pattern. Do not invent a new auth approach.
- Build only the current stage. Stop and confirm with David after each.
- Out of scope: auto-posting, posting tips/scheduling/calendars, any CRM link, Stripe/billing/plans, multiple text variations.
- Schema changes go through `npm run db:generate` in `worker/` (drizzle-kit); never hand-edit an applied migration.
- Worker: strict ESLint (TrackShows config) and 100% coverage (`npm run test:coverage`). Frontend: `npm run lint` at 0 warnings.
- Mobile-first CSS: `min-width` media queries only.
- No en or em dashes in any copy.
- Do not run Playwright on small UI changes.
- David runs all git, wrangler and deploy commands.

## Commands
- `worker/`: `npm test`, `npm run test:coverage`, `npm run lint`, `npm run typecheck`, `npm run db:generate`.
- `frontend/`: `npm run dev` (proxies `/api` to `wrangler dev` on 8787), `npm run build`, `npm run lint`.
- Deploy (David): `cd worker && npm run deploy` builds the frontend, applies D1 migrations, deploys.

## Gotcha
- npm 11.5.1 crashes (`reading 'edgesOut'`) when resolving vitest in `worker/`: vite 8.3's optional `@vitejs/devtools` peer pulls vitest 5 against the pool's vitest 4 pin. The lockfile is fine for `npm ci`; for `npm install <pkg>` there, use `npx npm@latest install`.
