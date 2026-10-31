# The real screens today (route → file → owned screen → states)

Read against `origin/main` @ `0c7d9f1` (2026-11-01 00:52 +0530), Next.js 15.5.28, React 19.1.
Every row: [VERIFIED: code read 2026-11-01, frontend-product-engineer] unless marked. "Measured" =
rendered on a local production build in demo mode this run (method: `baseline.md`).

## How the app is shaped
- App Router, server components by default; every product page is `export const dynamic = "force-dynamic"`
  (reads the JSON store on each request). Client components are the interactive islands
  (`"use client"`: decision buttons, approve, imports, Acting-as).
- Shell: `src/app/layout.tsx` + `src/components/Shell.tsx` (sidebar nav, workspace badge, theme select,
  ⌘K search in live mode only). `/pay/*` is customer-facing and renders without the shell.
- **Two modes** (`src/lib/mode.ts`): `DEMO_MODE` unset or `on` = demo (the default!). Demo nav shows only
  At a glance, All requests, New request, Books; the other pages are hidden from nav but reachable by
  URL. `DEMO_MODE=off` = live: full nav (Requests, Queue, Inbox, Payments, Bulk, Books, Settings).
- Demo labelling today: sidebar badge "Demo data" (title text explains it is fictional), sidebar
  "Demo mode · offline, fictional data", page-level `DemoBadge` on At a glance, All requests, request
  detail, Books; "simulated" next to each simulated transfer; "Simulated books: fictional company…" on
  Books. Live-mode workspaces get "Sample deposit cases" / "Uploaded files" / "Recorded chain data" badges.

## The five screens this engineer owns

| Owned screen | Route(s) | Files | What a finance controller does there |
|---|---|---|---|
| **1. Payment list** | `/requests/all` (demo + live; filters `?view=all|attention|progress|waiting|paid`); `/payments` (live: one payment ID per payment across instruction/chain/provider/bank/ledger legs); `/` queue (live deposit cases, `QueueTable`) | `src/app/requests/all/page.tsx`, `src/app/payments/page.tsx`, `src/app/page.tsx`, `src/components/QueueTable.tsx`, `StatePill.tsx`, `Status.tsx` | See every invoice request / payment and its status |
| **2. Match explanation** | `/requests/[id]` (verdict "What happened", "Likely cause (an inference…)", "Recoverable?", evidence timeline, transfers, "What this can't tell you"); `/requests/payments/[key]` (suggested match review); `/payments/[id]`; `/cases/[id]` (deposit investigation) | `src/app/requests/[id]/page.tsx`, `src/app/requests/payments/[key]/page.tsx`, `src/app/payments/[id]/page.tsx`, `src/components/Investigation.tsx`; copy from `src/lib/requests/present.ts` (`verdict`, `nextAction`, `replyDraft`) | Understand why a payment is right or wrong, in plain English, with evidence |
| **3. Approve / reject flow** | "Next step" on `/requests/[id]` (DecisionPanel: Mark paid, Accept as settled, Keep as credit, Record the refund, Not a payment: close it, Assign, Count it…; locked "Mark paid · blocked" for counterfeit/failed); suggested match Confirm/Reject on `/requests/payments/[key]`; inbox `ReviewDecide` Confirm/Reject on `/inbox/[itemId]` | `src/components/requests/RequestActions.tsx` (`DecisionPanel`, `COPY` table), `src/components/InboxActions.tsx`, `src/components/ActingAs.tsx` (`useActor`), API `src/app/api/requests/[id]/action/route.ts`, `src/app/api/inbox/resolve/route.ts` | Decide, with a required note and a named actor; every decision is recorded |
| **4. Exceptions queue** | "Needs attention" on `/requests` (At a glance, most urgent first) and `/requests/all?view=attention`; `/inbox` (live: payment exceptions, matching reviews, deposit investigations; status + kind chips; wide table / narrow cards); "Needs review" table on `/payments` | `src/app/requests/page.tsx`, `src/lib/requests/ui.ts` (`glance`), `src/app/inbox/page.tsx`, `src/app/inbox/[itemId]/page.tsx` | Work the problems first |
| **5. Xero entry preview** | "In your books" panel on `/requests/[id]` (status badge, reasons, "What will post when you approve:" lines table Payment / Fee write-off / Overpayment / Note, Approve button, "Already posted"); `/books` (provider, demo invoices, append-only audit log) | `src/components/books/BooksPanel.tsx`, `src/components/books/ApprovePosting.tsx`, `src/app/books/page.tsx`; plan from `src/lib/accounting/rules.ts` (`planPosting`) — **logic, not UI: the amounts shown come from here and are never computed or edited in the component** | See exactly what will post, approve it, see what posted and who approved |

Not owned but adjacent (touch only with the owner): `/pay/[publicId]` (customer-facing payment page;
lead-designer + crypto-protocol-engineer), `/requests/new` (form), `/settings`, `/bulk`, `/investigate`.

## States: what exists and what is missing (per owned screen)

Legend: ✅ exists (file:line or measured) · ⚠️ exists but weak · ❌ missing.

| Screen | Empty | Loading | Error (server/data) | Error (action) | Demo label |
|---|---|---|---|---|---|
| Payment list `/requests/all` | ⚠️ "Nothing here." table row, no next step (measured, `baseline/state-empty-requests-all-1280.png`) | ⚠️ inherits root `src/app/loading.tsx`: a skeleton grid labelled **"Loading cases"** (wrong noun; built for the deposit queue) | ❌ no `error.tsx` anywhere in `src/app`: an unreadable store shows Next's "Application error: a server-side exception has occurred… Digest: …" with HTTP 200 (measured, `baseline/state-error-store-unreadable-1280.png`) | n/a | ✅ DemoBadge when any demo request exists |
| Payment list `/payments` | ✅ "No payment records yet. Import instructions, a provider report or bank records below." | ⚠️ root skeleton ("Loading cases") | ❌ as above | ⚠️ PaymentImports messages; raw `(e as Error).message` possible from one route | ⚠️ page has no DemoBadge (sidebar badge only); in demo, imports are off ("Imports are off on this demo preview…") |
| Match explanation `/requests/[id]` | ✅ "Nothing has arrived at this invoice's address (0x…) yet." | ⚠️ root skeleton ("Loading cases") | ❌ no error boundary; unknown id → shared `not-found.tsx` says **"Case not found… Back to the queue"** linking `/` — wrong for requests, and the queue is hidden in demo; status 200 not 404 because the root `loading.tsx` streams (measured `/requests/NOPE-1` → 200) | n/a | ✅ DemoBadge + "simulated" per transfer + "What this can't tell you" |
| Approve / reject | n/a | ✅ buttons disable while busy | n/a | ⚠️ "Add a note first: it's kept with the decision." (good: says what to do, focuses the note — measured); "The server didn't answer. Nothing changed." (good); but fallback **"Failed (500)."** / **"Failed."** gives no next step (`RequestActions.tsx` `call()`, `ApprovePosting.tsx`, `ImportInvoices.tsx`) | ✅ (inherits page) |
| Exceptions `/requests` Needs attention | ✅ "Nothing needs a person right now." and whole-page empty "No payment requests yet" + Load demo / New request | ⚠️ root skeleton | ❌ | n/a | ✅ |
| Exceptions `/inbox` | ⚠️ "Nothing here." (no next step) | ⚠️ root skeleton | ❌ | ⚠️ server error text shown raw in `bar-red role=alert` | ⚠️ "Sample" badge on sample items; no page DemoBadge |
| Xero preview (BooksPanel) | ✅ panel hidden when invoice not from the books (`not_linked`); "Nothing to post yet" status | n/a (server-rendered with the page) | ❌ | ⚠️ ApprovePosting: success "Posted 2 line(s) to the demo books." (measured); failure `j.error ?? "Failed (<status>)."`; "The server didn't answer. Nothing was posted." (good) | ✅ "the demo books" wording; Books page "Simulated books: fictional company…" |
| `/books` | ✅ "Nothing posted yet." | ⚠️ root skeleton | ❌ | n/a | ✅ DemoBadge + simulated-books line |

## Copy on owned screens that conflicts with PRODUCT_FACTS / CLAIMS_REVIEW (open; for a PR, not a hotfix)
1. **"Paid automatically" KPI** (`src/app/requests/page.tsx` kpis section) renders whenever any request
   exists, **not only in demo**. Auto-mark-paid is on only in demo (`autoMarkPaid: demo`,
   `src/lib/requests/service.ts:36`). In live mode the tile would read "Paid automatically 0 of n" —
   a claim about a feature live mode doesn't have. Fix: render the tile only when `hasDemo`, labelled
   "in the demo", or rename to "Matched, ready to mark paid" in live mode. (CLAIMS_REVIEW A#2.)
2. **Hero sub-line** "Every payment is matched, checked and explained for you." (`requests/page.tsx`)
   shows in both modes. CLAIMS_REVIEW A#3/#4 say "every" is untrue (ambiguous payments go to a person).
   True-today: "When a payment is wrong, Clearline says why in plain English."
3. **Decision hint** `request_balance`: "…then it's marked paid automatically." (`RequestActions.tsx`
   `COPY`) is shown in live mode too, where `autoMarkPaid` is false. Make it conditional on the request's
   `autoMarkPaid` (as `present.ts:80,166` already do).
4. **Outcome line** "11 of 16 payments … matched and marked paid with no one touching them" is inside
   `hasDemo` — OK, but it has no "in the demo" words next to it; the badge is at the top-right. Keep the
   label adjacent if this block ever moves.
5. **Books, live mode**: "Xero: built. Connect with a free Xero developer app…" is true per PRODUCT_FACTS
   ("built, in testing") but omits "in testing"; add it.
Any change to 1-3 touches product claims; the Xero posting copy (5) sits next to posting: both go
through the definition of done, and 5 is approval-only if it changes what the Approve button does.

## Other UI defects found this run (measured; details in `baseline.md`)
- **Reflow:** `/books` demo invoice table has no `.table-wrap` → page 743 px wide at 390 and 320; its
  audit log grid (`150px 110px minmax(0,1fr)`) crushes text to one word per line at 390 (page 17,746 px
  tall). `/requests/DEMO-1047` 400 px at 390/320; `/requests/DEMO-1042` 370 px at 320; `/payments` 407 px.
- **Filter chips** use `aria-pressed` on `<a>` (axe aria-allowed-attr, critical) on `/requests/all` and
  `/inbox` (lead-designer A2, still open).
- **Focus is lost after an action:** after Enter on "Approve and post to the books" the button unmounts
  and focus falls to `<body>` (measured twice). WCAG 2.4.3 risk; move focus to the result message.
- **Disabled-for-reason buttons** (`.btn:disabled { opacity: 0.5 }`, the 🔒 "Mark paid · blocked") are
  not focusable; the reason is in a `title` tooltip that keyboard and touch users can't reach. The
  label text carries the main reason, which is acceptable; don't move reasons into `title` only.
- **`--text-3 #8a8d94`** still on `main` (lead-designer A1 not merged): the main source of the 727
  contrast failures.
