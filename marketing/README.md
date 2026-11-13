# Clearline marketing website

Next.js 15 + Tailwind static site (`output: "export"` → `out/`). No backend, no analytics, no cookies.

Pages: `/` Home · `/platform` · `/connect` · `/control` · `/use-cases` · `/developers` · `/trial` (Customer trial) · `/onchain` · `/about` · `/contact` · `/privacy`.

Route decisions: every page in the founder's brief got its own page. `/replay` (the Studio V2 trial page) is kept only as a `noindex` page that forwards to `/trial` so old links keep working. The Funding Desk has no page of its own: it is a separate prototype, covered under Control, Use cases (funding exposure) and Trial case 05.

## Design system

- Tokens: `app/tokens.css` (CSS custom properties, shared with the product console; copy verbatim).
- Spec: `../docs/design/DESIGN_SYSTEM.md` (colour and contrast, type scale, spacing, status families, stage labels, states).

## Links and settings

All product links derive from **one** constant, `PRODUCT_DEMO_URL` in `lib/site.ts` (default `https://clearline-customer-trial.vercel.app`):

| Constant | Path |
|---|---|
| `TRIAL_URL` | `/clearline/trial` (guided trial; main sandbox CTA) |
| `SOFTWARE_URL` | `/clearline` (test-mode console) |
| `API_DOCS_URL` | `/clearline/docs` |
| `FUNDING_DESK_URL` | `/mentor-demo` |

Environment overrides (all optional, must be `https://`):

- `NEXT_PUBLIC_PRODUCT_DEMO_URL`: product deployment origin.
- `NEXT_PUBLIC_SITE_URL`: canonical site origin for metadata, sitemap and robots.
- `NEXT_PUBLIC_BOOKING_URL`: booking page. Until set, Contact says "Booking link pending".
- `NEXT_PUBLIC_FORMSPREE_ID`: only when a Formspree form is configured and tested. Without it no form is rendered; the site shows the founder's email instead and never claims a message was sent.

Tests fail if a demo host is hard-coded outside `lib/site.ts`.

## Checks

```sh
npm install
npm test            # content, claims and link-constant assertions (node --test)
npx tsc --noEmit
npx next build      # writes out/
```

`next start` does not serve an `output: "export"` build. To preview, serve `out/` with any static server, e.g. `npx serve out -l 3310`.

## Content rules

- Stage labels only: Working synthetic engine · Illustrative UI · In development · No third-party integration. Never "live", "production" or "enterprise-ready".
- Sample tables come from the test-mode engine (`src/lib/clearline/core.ts`); data is fictional and labelled.
- No customers, logos, testimonials, metrics, team or investors. `public/` holds only the founder's real photo.
- Contact: the founder's verified email. Never ask for payment records.
