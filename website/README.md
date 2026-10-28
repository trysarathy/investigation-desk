# Clearline website

The marketing site: one landing page plus `/demo` and `/privacy`. Next.js (App Router) + Tailwind, exported as plain static files.

```
cd website
npm ci
npm run dev      # http://localhost:3400
npm run build    # writes the static site to out/
```

Animations are plain CSS plus a small scroll observer. Framer Motion was tried first, but it pushed the mobile Lighthouse performance score down to 59, so it was taken out.

## Put it online (Vercel, free)

1. vercel.com → **Add New → Project** → import `trysarathy/investigation-desk`.
2. **Root Directory: `website`**. Framework: Next.js. Leave the build settings at their defaults.
3. **Environment Variables** (copy from `.env.example`):
   - `NEXT_PUBLIC_SITE_URL`: your domain, e.g. `https://www.tryclearline.com`
   - `NEXT_PUBLIC_MEETING_URL`: your Google Calendar booking page. Until it's set, "Book a 15-minute call" scrolls to the form.
   - `NEXT_PUBLIC_FORMSPREE_ID`: from formspree.io → New form → the code after `/f/`. Formspree emails you each submission and keeps a copy in its dashboard.
   - `NEXT_PUBLIC_CONTACT_EMAIL`: an address on your domain. Until it's set, the footer shows LinkedIn only.
4. **Deploy.** Then go to Project → **Analytics** → Enable (cookie-free page views).
5. **Domain:** Project → Settings → Domains → add yours, then copy the DNS records Vercel shows into your registrar.

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
- **"52 of 52":** the held-out real-transaction test reported in `pitch/NOTE.md`. It's labelled on the page as our own test.
