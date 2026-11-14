# Clearline marketing website

Next.js 15 + Tailwind static site (`output: "export"` → `out/`). No backend, no analytics, no cookies.

Pages: `/` Home · `/platform` · `/connect` · `/control` · `/use-cases` · `/developers` · `/trial` (Customer trial) · `/onchain` · `/about` · `/contact` · `/privacy`.

Route decisions: every page in the founder's brief got its own page. `/replay` (the Studio V2 trial page) is kept only as a `noindex` page that forwards to `/trial` so old links keep working. The Funding Desk is Control's specialist funding workflow, not a separate product, so it has no page of its own: it is covered on Control (`/control#funding-desk`), Use cases and Trial case 05, and links to the interactive demo at `FUNDING_DESK_URL` (`/mentor-demo` on the product).

## Design system

- Tokens: `app/tokens.css` (CSS custom properties, shared with the product console; copy verbatim).
- Spec: `../docs/design/DESIGN_SYSTEM.md` (colour and contrast, type scale, spacing, status families, stage labels, states).

## Links and settings

All product links derive from **one** constant, `PRODUCT_DEMO_URL` in `lib/site.ts`. `next.config.mjs` resolves it at build time from `clearline-release.json` (via `release-urls.mjs`): a Vercel preview of an rc3 release branch links to the paired rc3 software preview; every other build links to the production URL. `lib/site.ts` keeps only a fallback.

| Constant | Path |
|---|---|
| `TRIAL_URL` | `/clearline/trial` (guided trial; main sandbox CTA) |
| `SOFTWARE_URL` | `/clearline` (test-mode console) |
| `API_DOCS_URL` | `/clearline/docs` |
| `FUNDING_DESK_URL` | `/mentor-demo` ("Clearline Funding Desk \| Interactive mentor demo") |

Environment overrides (all optional, must be `https://`):

- `NEXT_PUBLIC_PRODUCT_DEMO_URL`: product deployment origin.
- `NEXT_PUBLIC_SITE_URL`: canonical site origin for metadata, sitemap and robots.
- `NEXT_PUBLIC_BOOKING_URL`: booking page. Until set, Contact says "Booking link pending".
- `NEXT_PUBLIC_FORMSPREE_ID`: only when a Formspree form is configured and tested. Without it no form is rendered; the site shows the founder's email instead and never claims a message was sent.

Tests fail if a Vercel deployment host appears anywhere outside `lib/site.ts`, `clearline-release.json` and `release-urls.mjs`.

## Checks

```sh
npm install
npm test            # content, claims and link-constant assertions (node --test)
npx tsc --noEmit
npx next build      # writes out/
```

`next start` does not serve an `output: "export"` build. To preview, serve `out/` with any static server, e.g. `npx serve out -l 3310`.

## Content rules

- Stage labels only: Working synthetic engine · Interactive prototype · Design only, not built · No third-party integration. Never "live", "production" or "enterprise-ready".
- What works today and what is not built is written once, in `lib/disclosure.ts`, and rendered by `<Disclosure />` (Home, Platform, Trial). Change it there, and only to match what the released engine and console can demonstrate.
- The product view (`components/InvestigationView.tsx`) renders `lib/investigations.ts`, which is **generated** from the tested engine on `rc3/clearline-app` by `scripts/engine-investigations.gen.ts` (command in its header). It uses the console's own section names and labels. Regenerate it whenever the engine's sample changes; never edit it by hand.
- Other sample tables (`lib/sample.ts`) come from the same engine scenarios s1–s5, read through its own read models; data is fictional and labelled. Status names must match `src/lib/clearline/types.ts`.
- The guided-trial cases (`lib/cases.ts`) follow the console's guided trial (`src/components/clearline/pages/Trial.tsx`).
- No customers, logos, testimonials, metrics, team or investors. `public/` holds only the founder's real photo (120 × 150 px; never displayed larger).
- Contact: the founder's verified email. Never ask for payment records.
