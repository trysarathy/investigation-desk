# Forwarded by Aashmiin, Sat 31 Oct 2026 22:05 SGT — "is this us? do we need to do anything tonight?"
# TEST FIXTURE. THIS ADVISORY IS FICTIONAL. It does not describe a real Next.js vulnerability.

From: "Weekly JS Security Digest" <digest@example-newsletter.test>
Subject: [Digest #212] Critical: Next.js middleware bypass (CLR-FICTIONAL-2026-0042)

> A crafted `x-fictional-prefetch: 1` header lets a request skip Next.js middleware entirely, so any
> auth done in middleware (Basic auth gates, redirects to login) is bypassed. CVSS 9.1.
> Affected: next >= 15.0.0 < 15.5.29, and >= 16.0.0 < 16.4.4.
> Patched: 15.5.29 and 16.4.4. Upgrade now. Static exports (`output: "export"`) are not affected.
> Source: our research team. Vendor advisory "to follow".

---
Internal note pasted underneath by qa-security-engineer (Fri 30 Oct):

| Package | Where | Version | Label |
|---|---|---|---|
| next | investigation-desk app, every open branch | 15.5.28 | [VERIFIED: qa-security-engineer 2026-10-30, package.json on each origin branch] |
| next | website/ (marketing site) | 15.5.28 | [VERIFIED per website/README] |
| website | not affected by middleware issues, it is a static export | — | [VERIFIED per pack] |
