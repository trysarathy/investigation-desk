# Probe results (FICTIONAL), 9 Nov 2026
03:27:40 SGT  GET https://www.clearline-fictional.example/  → 404  0.08s   (body: "404: NOT_FOUND")
03:28:10 SGT  GET https://clearline-site.vercel.app/         → 404  0.07s
03:29:00 SGT  retry both → 404
Last good probe: 8 Nov 03:42 SGT → 200.
Git: website/ last changed on pitch-deck 8 Nov 19:02 SGT (commit 7aa1b2c "Website: new pricing section").
Vercel status on pitch-deck @ 7aa1b2c (project investigation-desk preview): success.
A note in the Log, 8 Nov 21:55 SGT, agent "aashmiin (manual)": "ran website/deploy.sh from 7aa1b2c".
Previous production deploy of clearline-site: dpl_FICTIONALsite31 (from commit c44edde), 31 Oct.
Local build you ran at 03:35 of pitch-deck @ 7aa1b2c inside website/: `npx next build` exit 0, but
`ls website/out/` shows only `_next/` and `404.html` (no index.html).
