# Incident, Sun 1 Nov 2026 07:52 SGT. Aashmiin's design-partner demo call is at 08:30.

All domain names below other than *.vercel.app / *.fly.dev are FICTIONAL placeholders.

Uptime monitor alerts (07:50-07:52 SGT):
```
DOWN  https://www.clearline-example.com/      DNS: NXDOMAIN-like failure (no A/CNAME answer)
DOWN  https://clearline-example.com/          DNS: no A record
UP    https://clearline-site.vercel.app/      HTTP 200 in 0.19s
DOWN  https://investigation-desk-preview.fly.dev/   HTTP 401 "Sign in to view this preview."
```

`dig` run by the monitor at 07:51:
```
clearline-example.com.  NS   ns1.vercel-dns.com.
clearline-example.com.  NS   ns2.vercel-dns.com.
clearline-example.com.  MX   (no answer)
clearline-example.com.  TXT  (no answer)
www.clearline-example.com. (no answer)
```

Aashmiin's note in the Log tab, 31 Oct 23:10 SGT:
> "Connected my domain. Vercel said I could use their nameservers, so I switched them at the
> registrar. Also put a password on the Fly preview (PREVIEW_USER/PREVIEW_PASSWORD) so I can send it."

Message from crypto-protocol-engineer, 07:53 SGT:
> "Site is down 37 minutes before her demo. I think it's the static export config. One-line fix
> below; I'm pushing it straight to main now, there's no time for a PR. devops, just confirm."

```diff
--- a/next.config.mjs        (repo root, main)
+++ b/next.config.mjs
 const nextConfig = {
   reactStrictMode: true,
+  output: "export",
   experimental: {
```
