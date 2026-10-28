# Clearline website

The marketing site: one landing page plus `/demo` and `/privacy`. Next.js (App Router) + Tailwind, exported as plain static files.

```
cd website
npm ci
npm run dev      # http://localhost:3400
npm run build    # writes the static site to out/
```

Animations are plain CSS plus a small scroll observer. Framer Motion was tried first, but it pushed the mobile Lighthouse performance score down to 59, so it was taken out.

## Put it online (independent of Git)

The live site is deployed straight from the built files. It has no Git connection, so nothing goes live by accident when the repo changes.

**One-time setup:**
- Create a token at vercel.com → Account Settings → Tokens.
- Add one line to `investigation-desk/.env`: `VERCEL_TOKEN=...`. That file is git-ignored; never paste the token anywhere else.
- Optionally add these to the same file:
  - `NEXT_PUBLIC_MEETING_URL`: your Google Calendar booking page
  - `NEXT_PUBLIC_FORMSPREE_ID`: from formspree.io → New form → the code after `/f/`. Formspree emails you each submission.
  - `NEXT_PUBLIC_CONTACT_EMAIL`: an address on your domain
  - `NEXT_PUBLIC_SITE_URL`: your domain, once it's connected

**Every update (one command, from the repo root):**

```
bash website/deploy.sh
```

It rebuilds, then deploys to the Vercel project `clearline-site`. Turn on cookie-free page views once: vercel.com → clearline-site → **Analytics** → Enable.

**A copy you can host anywhere:** `website/out/` after `npm run build` (the zip on your Desktop is the same files).

## Connect your domain (keeps your Google Workspace email working)

1. vercel.com → clearline-site → **Settings → Domains** → add `yourdomain.com` and `www.yourdomain.com`.
2. At your registrar, add **only** the records Vercel shows. Usually that's an **A** record for `@` and a **CNAME** for `www`; copy the exact values from the Domains page.
3. **Don't touch** the MX record, the `v=spf1 include:_spf.google.com ~all` TXT, `google._domainkey` or `_dmarc`. Those are your Google Workspace email records.
4. **Don't** switch the domain's nameservers to Vercel. Your registrar keeps the DNS, so the email records stay put.
5. Set `NEXT_PUBLIC_SITE_URL=https://www.yourdomain.com` in `.env` and run `bash website/deploy.sh` again, so the share image and sitemap use the domain.

## Know which channel brought each visitor

Add UTM tags to every link you share. The form saves the first tags a visitor arrived with, so each design-partner request says where it came from.

| Where | Link |
| --- | --- |
| Cold email signature | `https://your-domain/?utm_source=email&utm_medium=cold&utm_campaign=discovery` |
| LinkedIn DM | `https://your-domain/?utm_source=linkedin&utm_medium=dm&utm_campaign=discovery` |
| LinkedIn post | `https://your-domain/?utm_source=linkedin&utm_medium=post&utm_campaign=<post-name>` |
| Event follow-up | `https://your-domain/?utm_source=event&utm_medium=followup&utm_campaign=sff2026` |

## Where the content comes from

- **Words:** the approved film script (`demo/video/script_final.md`), the 6-slide mentor brief, and `demo/REQUESTS_DEMO.md`.
- **Screenshots:** the real app in demo mode (dark theme, 2x), fictional company "Northwind Pay". Captured with `pitch/src/capture_shots.py`, plus fresh hero and phone shots.
- **Film:** `pitch/demo_live_60s.mp4`, re-encoded to 1280p (2.5 MB).
- **"Why now" figures:** only the facts in `website/SOURCES.md`, each with its source link and the quoted line. Add nothing there that isn't in that file.
- **"In your books" screenshots:** Clearline's own posting panel in demo mode (fictional company), not Xero's screen.
- **"52 of 52":** the held-out real-transaction test reported in `pitch/NOTE.md`. It's labelled on the page as our own test.
