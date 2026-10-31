# Clearline security overview

Last checked against the code: 29 Oct 2026 (branch `accounting-fixes`). Every statement points to the file
that makes it true. Where something is not true today, it says **Not yet**.

Clearline is an early product built and run by one founder. It has **0 customers**, **no SOC 2 report** and
**no independent penetration test**. This document is written so you can decide whether a small, time-boxed
pilot is acceptable to you anyway, and what we would need to change first.

## 1. What Clearline can and cannot touch

| Area | What it does | Evidence |
|---|---|---|
| Blockchain | **Read-only.** Looks up transactions by hash, reads token metadata and issuer freeze lists through public or keyed read APIs. No wallet, no private keys, no seed phrases, no signing code. There is no code path that can move funds. | `src/lib/chain/` (`evm.ts`, `tron.ts`, `http.ts`), `README.md` "Live chain data" |
| Custody | **None.** Your receiving address is something you type in; Clearline only reads it. | `src/lib/requests/types.ts` (`receivingAddress`), `README.md` "Payment requests" |
| Accounting system (Xero) | Reads open sales invoices; **writes only when a person presses "Approve and post"** on a plan in state `ready`. If the plan changed since the page loaded, the server refuses. **In pilots, live posting is off:** Clearline gives you a Xero-ready import file that your accountant reviews and imports, until the Xero sandbox tests pass and Aashmiin approves. | `src/lib/accounting/service.ts` (`approveAndPost`), `src/app/api/accounting/[id]/route.ts`, `docs/ACCOUNTING_SYNC.md` |
| Audit of postings | Every approval, posting, failure and refused approval is appended to an audit list. | `src/lib/accounting/service.ts`, `/books` page |
| Audit of operations | Imports, clears, inbox changes, review decisions, exports: appended to `audit.jsonl` with actor, time and IP. | `src/lib/payments/audit.ts`, `src/lib/payments/live.ts` |

"Append-only" here means **the application only ever adds entries**. It is not tamper-evident: anyone with
shell access to the host can edit the files. Hash-chaining or write-once storage is **Not yet** built.

## 2. Data stored: exactly what, where, encrypted or not

Everything lives as files in one data directory on the server's disk: `.data/` under the working directory,
or `$DESK_DATA_DIR` (`src/lib/data-dir.ts`). There is **no database yet**. Writes are atomic (temp file then
rename) and serialised per file inside one server process (`src/lib/lock.ts`).

| File | Contents | Personal data? | Encrypted at rest? |
|---|---|---|---|
| `requests.json` | Payment requests: customer reference, invoice reference, amount, token, receiving address, transfers seen, engine checks, decisions, activity, look-alike addresses pasted on the payment page, names typed in "Acting as" | Customer reference and actor names can be personal data if you enter names | **No** (plain JSON) |
| `accounting.json` | Which books are connected, invoice links (Xero invoice ID, number, **contact name**, currency, amount due), account codes, posting audit list | Contact names from your Xero invoices | **No** |
| `xero-tokens.json` | Xero OAuth access token, refresh token, expiry, tenant ID and name | No, but it is a **live credential to your Xero organisation** | **No.** Plain JSON on the host's disk. Default file permissions [ASSUMPTION: usually readable by other users on the same host] |
| `workspace.json` | Uploaded Files A (address assignments) and B (deposit ledger) | Customer IDs; emails are refused by the validator (`src/lib/csv/files.ts`) | **No** |
| `payments.json`, `inbox.json` | Imported instructions, provider and bank records, payout ledger, matches, inbox items | Whatever the imported files hold (IDs, amounts) | **No** |
| `audit.jsonl` | Operational audit trail, including the requester's **IP address** | IP addresses, actor names | **No** |
| `cases.json`, `bulk/` | Investigation cases and bulk jobs | Customer IDs | **No** |
| `raw/`, `cache/` | Raw chain API responses with SHA-256, response cache | Public blockchain data | **No** |

In transit: the app itself serves plain HTTP on port 3000; TLS is provided by whatever sits in front (Fly.io,
Render, Cloud Run or a Cloudflare tunnel all terminate HTTPS). Calls out to Xero, chain APIs and Anthropic use HTTPS.

Encryption at rest is therefore **only whatever the host's disk provides** (for example, a cloud volume that the
provider encrypts). Clearline itself encrypts nothing. **Not yet.**

Secrets (Xero client secret, chain API keys, Anthropic key) come from environment variables only, never the repo
(`.env.example`, `.gitignore`). The Etherscan key is redacted from stored URLs; TronGrid's key travels in a header
that is never stored (`README.md` "Live chain data").

## 3. Access control: there is no sign-in

**Not yet.** Be clear about this before any pilot:

- There are **no user accounts, no sign-in, no roles**. Anyone who can reach the app URL can use every page and
  API route, including uploads, approvals and the Xero connection.
- "Acting as" is a name **the user types in**. It is stored in that browser's `localStorage` and sent with each
  change (`src/components/ActingAs.tsx`). It is self-declared and cannot be trusted as identity.
- The only gate is optional **HTTP Basic auth**: set `PREVIEW_USER` and `PREVIEW_PASSWORD` and every page and API
  asks for one shared username and password (`src/middleware.ts`). The comparison is constant-time. It is one
  shared password for everyone, with no per-person identity, no lockout and no MFA.
- The customer-facing payment page `/pay/<publicId>` is deliberately outside that gate; its link ID is random.
- Single tenant: one deployment = one company. There is no multi-tenant isolation because there is nothing shared.
- The Xero OAuth flow checks a `state` cookie, so a connection can only complete from the server that started it
  (`src/app/api/accounting/xero/callback/route.ts`).

**What we do for a pilot today:** one dedicated deployment per pilot customer, behind Basic auth with a long random
password shared only with named people, plus (if you want it) an IP allow-list at the host. **On the roadmap:** real
sign-in.

## 4. AI

Optional. If `ANTHROPIC_API_KEY` is set and `AI_EXPLANATIONS` is not `off`, Claude writes a plain-English
explanation of a verdict the rules already decided. It receives the verdict code, evidence objects with customer IDs
removed, and the reply template (`src/lib/ai/explain.ts`). Output that cites unknown evidence or invents numbers is
rejected (`src/lib/ai/validate.ts`). The Docker image sets `AI_EXPLANATIONS=off` (`Dockerfile`). For pilots we
leave it **off** unless you agree otherwise in writing. A zero-retention agreement with Anthropic is **Not yet** in
place.

## 5. Retention and deletion

| What | How it is deleted today | Manual? |
|---|---|---|
| Imported payment records, import log, match results | "Clear records" (`POST /api/payments/clear`) | In-app, but the audit entries remain |
| Demo records | "Reload / Reset demo" removes demo records only (`src/lib/demo/reset.ts`) | In-app |
| Payment requests, accounting links, posting audit | **No delete button.** The founder stops the server and deletes `requests.json` / `accounting.json` | **Manual** |
| Xero connection | **No disconnect button.** Delete `xero-tokens.json`, and revoke the app in Xero (Settings → Connected apps) | **Manual** |
| Audit logs (`audit.jsonl`) | Never trimmed by the app. Deleted with the whole data directory | **Manual** |
| Everything | Delete the data directory and the host volume, then confirm in writing | **Manual** |

There is no automatic retention schedule. For pilots we commit to delete all pilot data within **10 business
days** of the pilot ending or of your written request, and to confirm in writing. This is a promise kept by a
person, not by code.

## 6. Hosting options

1. **Your infrastructure** (preferred by security teams): run the `Dockerfile` in your own cloud account. Data never
   leaves your environment except for chain lookups and Xero calls. Set `DEMO_MODE=off`, mount a volume for the data
   directory, run **one** process (locks don't span processes, `src/lib/lock.ts`).
2. **A dedicated container we run** on Fly.io, Render or Google Cloud Run, in a region you choose (Singapore
   available on all three [ASSUMPTION: check per provider at setup]). One per customer.
3. **Demo only:** `DEMO_MODE=1` preview with fictional data; uploads and imports are refused (`src/app/api/uploads/[kind]/route.ts`).

Public chain RPCs see the hashes and addresses looked up (`.env.example`). For a pilot, keyed providers are better.

## 7. Known gaps, and what we'd do first

| Gap | Today | Plan |
|---|---|---|
| Sign-in and roles | None; shared Basic auth at most | Sign-in with email + TOTP, then SSO (Google / Microsoft); roles as in `docs/SPEC.md` §7 |
| Xero tokens at rest | Plain JSON | Encrypt with a key from the host's secret manager; restrict file mode to 0600; add "Disconnect" that revokes |
| Database | JSON files, one process | Managed Postgres, Singapore region, encrypted, with backups |
| Tamper-evident audit | App-level append only | Hash-chained entries, exported daily |
| Deletion | Mostly manual | Per-record and whole-workspace delete, logged |
| SOC 2 / pen test | None | Independent pen test before the first customer with real volume; SOC 2 only once customers require it and revenue supports it |
| CI, dependency scanning | Tests exist (`tests/`), no CI pipeline | CI running tests, typecheck, `npm audit` and Dependabot |

## On the roadmap

- **Sign-in / SSO** (email + TOTP first, then Google and Microsoft SSO). **Not yet.**
- **Encryption at rest for Xero tokens.** **Not yet.**
- **A database** (managed Postgres) replacing JSON files. **Not yet.**
- **SOC 2.** **Not yet**, and not planned before there are paying customers who need it.

Contact for security questions: the founder, Aashmiin Kaur, by email.
