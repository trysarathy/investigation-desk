# Runbook: reproduce the CI checks locally

The same commands CI runs (`.github/workflows/ci.yml`, `clearline-browser.yml`). Fictional data only.

```bash
npm ci
npx tsc --noEmit
npx vitest run
npx next build
npx playwright test --config=playwright.clearline.config.ts --retries=0 --trace off
npm run lint          # CI "lint" job; not a required check yet (see docs/release/CI_BASELINE_RC5.md)
```

## Browser

- CI installs Playwright's own Chromium (`npx playwright install --with-deps chromium`).
- Locally, if `npx playwright install` is not possible, point the config at an installed Chrome:
  `CLEARLINE_PW_CHROMIUM=/path/to/chrome`. `playwright.clearline.config.ts` also tries the cloud-sandbox paths
  `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` and `…/chromium-1194/chrome-linux/chrome`.
- The web server is `next start` on 127.0.0.1:3184 with `CLEARLINE_CUSTOMER_PREVIEW=1`; build first.
- On a small disk, set `TMPDIR=/dev/shm` so Chromium's profile and caches do not fill the root disk (rc4 crashes
  were resource errors, not assertion failures).

## Accessibility (axe)

- axe-core is a **pinned devDependency** (`package.json`, exact version). Every Clearline browser spec loads it
  through `tests/browser/axe-source.ts`, which fails the test if axe cannot be loaded (missing, empty, not an axe build, or older than 4.14). No axe test
  skips for lack of axe; some run on desktop only by design (`test.skip(isMobile, …)`).
- `CLEARLINE_AXE_PATH`, else `QA_AXE_PATH`, overrides the file (e.g. to try a newer axe). Only the first one set is
  used, and an override that does not exist is an error, not a fallback.
- Upgrading axe can add rules (4.14 made `label-content-name-mismatch` default): fix the UI, do not disable rules.

## Do not

- `pkill -f next-server` — it kills other sessions' servers. Stop only the process you started (by pid).
- Commit regenerated `docs/trial/screenshots/*.png` unless the change is intended (the screenshot spec rewrites them).
