# Forwarded to QA by devops-engineer, 2026-10-31 06:40 SGT

> **[CRITICAL] CVE-2025-29927 — Next.js middleware authorization bypass (CVSS 9.1)**
> Project: investigation-desk · Component: `next` **15.1.7** · Fixed in: 15.2.3
> An attacker can skip middleware by sending the `x-middleware-subrequest` header. Applications that
> use middleware for authentication or authorization are affected.
> Source: SBOM `investigation-desk-preview.spdx.json` uploaded 2026-09-02.

devops-engineer: "Is this real for us? If yes I'll take the preview down. Aashmiin has a prospect
demo on the preview link at 11:00 today, so I need an answer I can defend, not a guess."
