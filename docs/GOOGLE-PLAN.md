# Kabooly Marketing: Google plan

Agreed with David 2026-10-06. Nothing built yet. This is the next block of
work after the advert formats, and it is the first part of the tool that is
not an AI-generated picture.

## Why

Semrush and Ahrefs charge for two things a small business cannot use anyway:
keyword volumes and backlink indexes. What they do not sell is the customer's
own data, which Google gives away for free. So the whole block adds no
recurring cost: Search Console and Business Profile APIs are free, and the
only spend is a little Haiku for drafting review replies, inside the text caps
that already exist.

## The rule this block must not break

We make it, you post it. Nothing is published on anyone's behalf, in any
format, on any platform. Instagram, Facebook and Nextdoor are copied and
pasted by hand, so Google is too, including review replies and Google posts
(David, 2026-10-06: consistency matters more than convenience, because a
customer has to be able to say what the tool does in one sentence).

The APIs are therefore read-only in spirit: they bring the customer's own
numbers and reviews in, and everything going out leaves as text the customer
pastes.

## The UI has to be restructured first

Agreed with David 2026-10-06. The tool currently opens on the image advert
form, which only made sense while making an advert was the only thing it did.
Adding search and reviews breaks that, so the navigation is regrouped and the
landing page becomes a Home page, not a form.

- Home. What to do this week: new reviews waiting, what moved in search,
  allowance left. This is the new landing page.
- Create. Image advert, photo post, carousel, video, and the library beneath
  them, because the library is what you made.
- Get found. Search Console and keyword ideas.
- Reputation. Reviews, replies, and the review request link and QR code.
- Settings. Global as now, plus the two Google connections.

The restructure comes before the Google stages, so each one lands in a section
that already exists rather than being bolted onto a create screen.

Built 2026-10-06, not deployed: the Home page, the Create group with the
library inside it, and the create screens moved to `/create`, `/create/photo`,
`/create/carousel` and `/create/video`, with the old top-level paths
redirecting. Get found and Reputation are added with their own stages rather
than as empty sections.

## Stages

1. DONE 2026-10-06, not deployed. Google account connection. `GET
   /api/google/search_console/connect` redirects to Google's consent screen
   with a signed state; `GET /api/google/callback` swaps the code for a
   refresh token, stores it encrypted (AES-GCM, `GOOGLE_TOKEN_KEY`) in
   `google_connections` with the Google account's email, and sends the
   customer back to `/settings?google=connected`. `GET
   /api/google/connections` lists what is connected, `DELETE
   /api/google/:service` removes it and tells Google to forget the token.
   Settings has the card. `connectionToken` in `worker/src/google/store.ts`
   is what stage 2 asks for an access token.
2. DONE 2026-10-06, not deployed. Search Console panel at `/get-found`,
   from one route, `GET /api/search-console/overview`. It matches the
   customer's profile website against the properties their Google account
   can see (a domain property wins), then reads five windows: the totals for
   the last 28 whole days and the 28 before, the top queries, and the pages
   for both windows. It returns the figures with their change, the searches
   sitting between places 8 and 20 ("nearly there", the actionable bit), and
   the pages that dropped three places or more. Google finishes counting a
   day two or three days late, so the window ends three days ago. Blocked
   states (`not_connected`, `no_website`, `no_property`, `no_profile`) come
   back as 409s with a code, and the page turns each into one plain
   sentence.
3. BUILT 2026-10-06, cannot be used until Google approves Business Profile
   API access, and untested against the real API. Reviews and replies at
   `/reviews`. `GET /api/reviews` finds the account and its first location
   (Account Management and Business Information APIs), then reads the last
   20 reviews from the old v4 endpoint, newest first. `POST
   /api/reviews/reply` writes one reply with Haiku in the business's tone,
   counted against the text allowance, and hands it back as text for the
   customer to edit and paste. Nothing is posted to Google. Blocked states
   (`not_connected`, `no_location`) come back as 409s with a code. The
   Business Profile connection is its own button in Settings, asking for
   `business.manage` only because reviews have no read-only scope.
4. DONE 2026-10-06, not deployed. Review requests at `/reviews`. The
   customer pastes the share link from their own Google Business Profile
   (no API, so this ships without Google's approval), and the app mints
   `marketing.kabooly.com/r/{slug}`: a seven character code, stored in
   `review_links`, redirecting to their Google review page. The slug never
   changes, so a printed QR code keeps working when they change the Google
   address. The page also draws the QR code in the browser (`lib/qr.ts`,
   `qrcode` loaded only on that page) and writes the message to text a
   customer. `/r/*` is in `run_worker_first`, so the Worker answers it
   rather than the SPA. The target must be an https Google address, checked
   on save, or the short link would be an open redirect on Kabooly's own
   domain.
5. DONE 2026-10-06, not deployed, and it needs nothing from Google.
   Because posts are pasted by hand, no API is involved: Google is simply a
   fourth platform in the existing advert flow, square at 1200x1200 (Google
   asks for 720x720 or larger and no particular shape, checked 2026-10-06).
   It is unticked by default, like a Story, so nobody's image allowance is
   quietly spent on a listing they may not have. A profile saved before
   Google existed has no brand strip for it, so `makePlatformImage` falls
   back to another platform's strip, which is the same artwork at the same
   share of the width; the right one is written on the next profile save.
6. Keyword ideas. What to write and post about next, built from the Search
   Console terms rather than guessed. Deliberately last: without stage 2 it is
   Haiku inventing keywords, which is what everyone else's free tool does.

## Before stage 1 can be used live

- Add `https://marketing.kabooly.com/api/google/callback` as an authorised
  redirect URI on the Google OAuth client, and
  `http://localhost:5173/api/google/callback` for local work.
- Add the `webmasters.readonly` scope to the OAuth consent screen and submit
  it for verification. Until that is approved only test users can connect.
- `wrangler secret put GOOGLE_TOKEN_KEY` with 32 random bytes, base64url:
  `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`. Changing it later
  makes every stored connection unreadable, so customers reconnect.

## External gates, not code

- Search Console needs `webmasters.readonly`, which Google treats as a
  sensitive scope, so the OAuth consent screen has to be verified before
  customers can use it. Days to weeks.
- Reviews need Business Profile API access, which is an application to Google,
  not a switch. Weeks, and they can refuse. Reviews and replies are only in
  the older v4 endpoints, which have no read-only scope, so the ask is
  `business.manage` even though we never write.
- Stages 1, 2, 4, 5 and 6 do not depend on the Business Profile
  application, stage 5 included: a Google post is copied and pasted like
  every other platform, so it needs no API. Only stage 3 depends on it. Stage 3 is written but cannot be exercised until
  the application is approved, so its first real run is also its first test
  against Google.

## Decisions taken

- No on-page SEO audit of the customer's own website (David, 2026-10-06):
  Kabooly builds those sites, so a tool that marks its own homework invites an
  argument we do not want.
- No keyword volumes. We will not buy a data feed, and a made-up volume is
  worse than none.
- Google posts stay manual, like every other platform.
- It all stays inside the £40 Marketing price (David, 2026-10-06). The APIs
  are free and review replies cost a little Haiku, inside the text caps that
  already exist, so nothing here moves the price or the bundle.
- Two separate connections, not one (David, 2026-10-06): "Connect Search
  Console" asks only to read search data, and "Connect Business Profile" is a
  second button asked for separately. One combined consent screen would ask
  for `business.manage` up front, and "manage your business listing" is a
  frightening thing to agree to for a feature they may not want. The cost is
  two consent journeys and two connection states in Settings.
