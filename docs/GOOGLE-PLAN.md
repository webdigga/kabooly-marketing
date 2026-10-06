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
3. Reviews and replies. Their Business Profile reviews pulled in, each with a
   reply drafted in their tone of voice, copied out and pasted into Google by
   them.
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
5. Google posts. A Business Profile post as a fourth platform tick box in the
   existing advert flow: image at Google's size plus the words, downloaded and
   posted by hand like the other three.
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
- Stages 1, 2, 4 and 6 do not depend on the Business Profile application.
  Stages 3 and 5 do. Build in that order so a refusal costs us two stages, not
  six.

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
