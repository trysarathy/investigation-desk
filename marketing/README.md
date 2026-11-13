# Clearline marketing website

A separate Next.js 15 / Tailwind CSS marketing site for Clearline's funding-exposure operating desk. Four pages: `/`, `/replay`, `/onchain`, `/privacy`.

**This is not the Funding Desk app.** It links to the fictional-data prototype; it cannot move money or make funding decisions.

## Local development

Requires Node.js 22+.

```sh
cd marketing
npm install
cp .env.example .env.local
npm run dev
# Open http://localhost:3000
```

Build & checks:

```sh
npm run typecheck
npm run test
npm run build
```

The marketing pages are statically exported to `out/`. There is no backend and no analytics enabled.

## Connect + Control live demo URL

`NEXT_PUBLIC_PRODUCT_DEMO_URL` defaults to the existing test-mode `/clearline` preview. Set this to the new validated customer trial deployment URL when a new Vercel preview has passed browser checks. The Funding Desk `DEMO` link remains separate.

## Formspree setup (required to receive requests)

1. Create a Formspree form under your own account and configure its destination email, verified access and spam protection.
2. Copy **only the Form ID** from `https://formspree.io/f/FORM_ID`.
3. In Vercel Project → Settings → Environment Variables, set `NEXT_PUBLIC_FORMSPREE_ID` to the ID in Preview and Production as appropriate. Redeploy after changing it.
4. Verify delivery with a harmless test message; test the success and failure states and Formspree privacy settings.
5. Until configured, the form is visibly disabled and does not claim to have sent a message.

Never commit form secrets or personal files; public Formspree IDs are intended to be exposed on the client.

## Booking URL and founder photo

Set `NEXT_PUBLIC_BOOKING_URL` to the real `https://` scheduling page. Until then "Book a call" leads to the replay contact form. The provided founder photo is installed at `public/founder.jpg`. Check it visually in the deployed preview. The site intentionally includes no stock photos.

## Custom domain

1. Vercel → the **clearline-marketing** project → Settings → Domains → Add your verified domain.
2. Follow Vercel's displayed DNS instructions with your domain registrar.
3. Set `NEXT_PUBLIC_SITE_URL=https://your-domain.example` for SEO metadata and sitemap, then redeploy.
4. Check the sitemap, Open Graph social preview, robots.txt, domain SSL, and whether the root domain redirects as intended.

Before a custom domain exists, set `NEXT_PUBLIC_SITE_URL` to the actual preview URL for realistic metadata. The default `https://clearline.example` is deliberately a placeholder and must be replaced before public launch.

## Vercel deploy (separate project)

- Create a new Vercel project connected to `trysarathy/investigation-desk`.
- Set project **Root Directory** to `marketing`.
- Framework preset: Next.js; deployment target: Preview.
- Set Git production branch only when a public production release is approved. The development branch is `site/clearline-marketing-v1` and should remain unmerged pending review.
- No existing Funding Desk or Connect/Control project needs to be modified.
- Preview protection may require Vercel sign-in; set intended audience access in Vercel settings before sharing.

## Content and accuracy checks

- Product scope: Current Funding Desk includes cases, five checks, maker-checker, outstanding ledger, exceptions, evidence/exports and CSV workflows using fictional demo data. Onchain is **in development / testnet**.
- The work-queue mock is an HTML/CSS illustrative rendering, not a screenshot from a real customer's account.
- The funding timeline uses illustrative values; no real clients, metrics, quotes, testimonials or partner logos.
- The marketing form is disabled until configured. The founder’s supplied SMU email is used for public contact; booking URL remains pending. Privacy handling language is provisional and must be verified against actual processor terms before public intake.
- Pricing in the FAQ is marked as individually agreed for any future pilot; check alignment with founder-approved commercial terms before production launch.
- Financial and jurisdiction-specific legal classifications require external counsel review.

## Accessibility and performance

Semantic landmarks, skip navigation, labeled forms, visible focus rings, keyboard-accessible FAQ, reduced-motion support, text-based dashboard mock, and no runtime animation libraries. Test with Lighthouse and a keyboard/screen reader on the deployed URL; **90+ Lighthouse is a target, not a measured claim**.

## File map

- `components/Shared.tsx` — navigation, footer, CTAs and canonical demo link.
- `components/ContactForm.tsx` — Formspree submission with disabled configuration state.
- `components/QueueMock.tsx` — fictional funding queue UI.
- `app/opengraph-image.tsx` — generated branded PNG Open Graph asset.
- `app/sitemap.ts`, `app/robots.ts`, `app/icon.svg` — crawl/social branding.
