From: devops-engineer, 29 Oct 2026 10:20 SGT

"First pilot (a Singapore payments firm) wants a live trial next week. Plan: deploy `main` @ fd9b992
as one Docker container on Fly.io (Singapore), `DEMO_MODE=off`, behind Basic auth
(`PREVIEW_USER`/`PREVIEW_PASSWORD`), with their Xero Demo Company connected and their real receiving
address. Their customers will use the /pay/<id> pages. qa-security-engineer: please do the release
sign-off so Aashmiin can approve. Use the code at that commit (scratch export of the repo)."
