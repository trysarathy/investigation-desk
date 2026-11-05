# Clearline tester edition: share or host

**Synthetic replay — no funds move.** This folder is a static site. It contains only the built-in synthetic
scenarios, with results generated in advance by the Python engine (3 checkpoints × 0% and 8% presets). It has
no server, no upload, no account, no analytics and no network calls. Every file in it is readable by whoever
receives it.

- `Clearline_Tester/`: the site, with `index.html` at the root and relative paths only.
- `Clearline_Tester.zip`: the same folder, to send as an attachment.

## Send the ZIP (works today)
Attach `Clearline_Tester.zip` and tell the tester: *"Unzip the whole folder, then double-click `index.html`;
it opens in your browser with no install, login or internet connection."*

## Host it (pick one; each takes a couple of minutes, and you choose who can see it)
- **Netlify Drop (no repository or settings change):** open https://app.netlify.com/drop while signed in,
  drag the `Clearline_Tester` folder onto the page, and copy the `*.netlify.app` URL it gives you. Open that
  URL in a private window to check it before you send it.
- **GitHub Pages:** the branch `tester-pages` already holds only this site, under `/docs`. In GitHub → repository
  Settings → Pages → "Deploy from a branch", choose branch `tester-pages` and folder `/docs`, then save. The site
  appears at `https://trysarathy.github.io/investigation-desk/` after a minute or two. The repository is public,
  so anyone with the link can open it. Check the link in a private window before you send it.
- **Any static host** (Vercel, Cloudflare Pages, S3): upload the contents of `Clearline_Tester/`. No build
  command is needed.

Do not host the Python development server (`app/server.py`) or the `fixtures/` folder.

## Rebuild after changing the app
From `funding-replay/`:

    rm -rf tester-build/Clearline_Tester tester-build/Clearline_Tester.zip
    python3 tools/export_tester.py tester-build/Clearline_Tester
    (cd tester-build && python3 -m zipfile -c Clearline_Tester.zip Clearline_Tester)
    node tests/browser/recipient.cjs "$PWD/tester-build/Clearline_Tester"
