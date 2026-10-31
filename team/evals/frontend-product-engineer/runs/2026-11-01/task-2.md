# Task 2: error and not-found states for the request pages (plan tasks-2026-11-02 row 4; F3, F4)

Golden-task run: no build, no server, no GitHub writes. Code below is what I would open as a PR; every
result is "not run".

## Restated task + acceptance
- A failed server load of any `/requests…` page (`/requests`, `/requests/all`, `/requests/[id]`,
  `/requests/payments/[key]`, `/requests/new`) shows plain English, a **Try again** that actually
  re-fetches, and a link out, inside the normal app shell (sidebar stays). No "Application error…",
  no digest, no raw exception text.
- An unknown request id says "request" (not "case"), names the id, and links to a page that exists in
  both demo and live (`/requests/all`), not `/` (which redirects in demo and is the deposit queue in live).
- Unknown suggested-match key on `/requests/payments/[key]` gets its own honest not-found too (same
  segment, same bug: it falls through to the root "Case not found").

## Where they live in the route tree, and why
```
src/app/layout.tsx                 root layout (Shell: sidebar, demo badge)
src/app/not-found.tsx              root not-found ("Case not found") — kept, still right for /cases/[id]
src/app/requests/error.tsx         NEW  error boundary for the whole /requests subtree
src/app/requests/[id]/not-found.tsx         NEW  unknown request id
src/app/requests/payments/[key]/not-found.tsx NEW unknown suggested-match key
src/lib/requests/states.ts         NEW  the words (pure functions, unit-tested)
src/components/requests/MissingId.tsx       NEW  tiny client island that reads the id from the URL
tests/states.test.ts               NEW  vitest, written first
```
- **`requests/error.tsx`**: Next's `error.js` wraps the segment's `page` (and every child segment) in a
  React error boundary [VERIFIED: https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/03-file-conventions/error.mdx — opened by frontend-product-engineer 2026-11-01 per `standards.md` S5; not re-opened this run, network off]. Placed at `requests/`, one file
  catches `/requests`, `/requests/all`, `/requests/[id]`, `/requests/payments/[key]` and `/requests/new`.
  It sits **inside** the root layout, so the sidebar, workspace badge and "Demo data" badge stay on
  screen — the controller isn't dropped onto a blank page. There is no `requests/layout.tsx`, so nothing
  in the subtree escapes it. It must be a client component (`"use client"`).
- **Why not the root `src/app/error.tsx` in this PR:** the plan row is the request pages; `/books`,
  `/inbox`, `/payments` need the same and I'll propose that as the next row (one concern per PR). A
  root-layout failure would need `global-error.tsx`; out of scope, noted.
- **Props on our version:** our installed Next is 15.5.28 and its `error-boundary.d.ts` types the
  component as `{ error: Error; reset?: () => void }` and passes `reset` (fixture t2, real). The canary
  docs show `retry` — that's a newer API; **use `reset`** on 15.5.28 (`standards.md` S5 version note).
- **`reset()` alone doesn't fix a server-component failure**: it re-renders with the same failed RSC
  payload. So Try again does `router.refresh()` (re-fetch from the server) and `reset()` inside
  `startTransition` [ASSUMPTION: recalled Next 15 pattern, docs not re-opened this run — verified in the
  PR by the "restore the store, press Try again, page loads" test below].
- **`not-found.tsx` per segment**: `notFound()` renders the nearest `not-found.tsx` up the tree;
  `requests/[id]/page.tsx:79` and `requests/payments/[key]/page.tsx:19` call `notFound()` today and get
  the root "Case not found". `not-found.tsx` doesn't receive `params`, so the id comes from the URL via a
  small client component (`usePathname`). Demo vs live wording comes from `isDemoMode()` on the server.
- **HTTP status stays 200** for both (known limit): the root `loading.tsx` starts streaming before the
  page throws or calls `notFound()`, so the 200 header is already sent (measured `/requests/NOPE-1` → 200
  in the baseline). The page adds `noindex` automatically on not-found. Fixing the status means moving
  the root loading boundary — a separate, riskier change; I'll write it as a roadmap row, not hide it.

## Code

### `src/lib/requests/states.ts` (new)
```ts
// Words for the request pages' error and not-found states. Lives in lib so it is unit-tested;
// the components only render what these return. Rules: team/knowledge/.../error-messages.md.

export type Way = { href: string; label: string };

export type ErrorCopy = { title: string; body: string; retry: string; out: Way };

/** Whole-page load failure on a /requests page. Never includes error text, codes or digests. */
export function requestsErrorCopy(pathname: string): ErrorCopy {
  // If At a glance itself failed, don't send them back to it.
  const out: Way = pathname === "/requests" || pathname === "/requests/"
    ? { href: "/books", label: "Go to Books" }
    : { href: "/requests", label: "Go to At a glance" };
  return {
    title: "This page couldn't load",
    body: "Your data hasn't changed: no request, decision or posting was touched. Try again, and if it keeps happening, note the time and tell support.",
    retry: "Try again",
    out,
  };
}

export type NotFoundCopy = { title: string; body: string; out: Way };

/** Unknown request id. `id` is shown as typed (trimmed, max 40 chars) so the user can see a typo. */
export function requestNotFoundCopy(id: string, demo: boolean): NotFoundCopy {
  const shown = id.trim().slice(0, 40) || "with that ID";
  const name = shown === "with that ID" ? "There's no request with that ID" : `There's no request ${shown}`;
  return {
    title: "Request not found",
    body: demo
      ? `${name} in this workspace. It may have been removed when the demo was reloaded.`
      : `${name} in this workspace. Check the ID, or find the request in All requests.`,
    out: { href: "/requests/all", label: "Go to All requests" },
  };
}

/** Unknown suggested-match key (/requests/payments/[key]). Keys are long; never echo them. */
export function paymentNotFoundCopy(demo: boolean): NotFoundCopy {
  return {
    title: "Payment not found",
    body: demo
      ? "That payment isn't in this workspace. It may already have been matched, or the demo was reloaded."
      : "That payment isn't in this workspace. It may already have been matched to a request.",
    out: { href: "/requests/all?view=attention", label: "Go to Needs attention" },
  };
}
```

### `tests/states.test.ts` (new; written first — fails with "Cannot find module" until states.ts exists)
```ts
import { describe, expect, it } from "vitest";
import { paymentNotFoundCopy, requestNotFoundCopy, requestsErrorCopy } from "@/lib/requests/states";

const BANNED = /failed|error|digest|exception|invalid|please|sorry|oops|case|queue|!|\(\d{3}\)/i;

describe("request page states", () => {
  it("error copy is plain, says nothing changed, and offers a way out that isn't the failing page", () => {
    const c = requestsErrorCopy("/requests/all");
    expect(c.title).toBe("This page couldn't load");
    expect(c.body).toContain("Your data hasn't changed");
    expect(`${c.title} ${c.body} ${c.retry}`).not.toMatch(BANNED);
    expect(c.out.href).toBe("/requests");
    expect(requestsErrorCopy("/requests").out.href).toBe("/books");
  });
  it("unknown request says request, names the id, links to All requests in both modes", () => {
    for (const demo of [true, false]) {
      const c = requestNotFoundCopy("NOPE-1", demo);
      expect(c.title).toBe("Request not found");
      expect(c.body).toContain("There's no request NOPE-1 in this workspace.");
      expect(c.out).toEqual({ href: "/requests/all", label: "Go to All requests" });
      expect(`${c.title} ${c.body}`).not.toMatch(BANNED);
    }
    expect(requestNotFoundCopy("NOPE-1", true).body).toContain("demo was reloaded");
    expect(requestNotFoundCopy("NOPE-1", false).body).not.toContain("demo");
  });
  it("caps a very long id and handles an empty one", () => {
    expect(requestNotFoundCopy("X".repeat(500), false).body.length).toBeLessThan(200);
    expect(requestNotFoundCopy("  ", false).body).toContain("There's no request with that ID");
  });
  it("unknown payment never echoes the key and links to Needs attention", () => {
    const c = paymentNotFoundCopy(false);
    expect(c.out.href).toBe("/requests/all?view=attention");
    expect(c.body).not.toMatch(/0x|ethereum:/);
  });
});
```

### `src/app/requests/error.tsx` (new)
```tsx
"use client";

// Error boundary for every /requests page: plain words, a real retry (re-fetch + reset), a way out,
// inside the normal shell. Never shows the error message or digest (they stay in the server log).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";
import { requestsErrorCopy } from "@/lib/requests/states";

export default function RequestsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/requests";
  const heading = useRef<HTMLHeadingElement>(null);
  const c = requestsErrorCopy(pathname);
  useEffect(() => {
    console.error(error); // dev console only; production already strips the message
    heading.current?.focus(); // keyboard and screen-reader users start at the message, not <body>
  }, [error]);
  const retry = () => startTransition(() => { router.refresh(); reset(); });
  return (
    <div className="page">
      <div className="panel" role="alert">
        <div className="panel-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 ref={heading} tabIndex={-1} style={{ margin: 0 }}>{c.title}</h1>
          <p className="muted" style={{ margin: 0 }}>{c.body}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={retry} data-testid="error-retry">{c.retry}</button>
            <Link className="btn" href={c.out.href}>{c.out.label}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### `src/components/requests/MissingId.tsx` (new)
```tsx
"use client";

// not-found.tsx gets no params, so read the id from the URL to name it on screen.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { requestNotFoundCopy } from "@/lib/requests/states";

export function MissingRequest({ demo }: { demo: boolean }) {
  const last = (usePathname() ?? "").split("/").filter(Boolean).pop() ?? "";
  let id = last;
  try { id = decodeURIComponent(last); } catch { /* keep raw */ }
  const c = requestNotFoundCopy(id, demo);
  return (
    <div className="page" data-testid="not-found">
      <h1 style={{ margin: 0 }}>{c.title}</h1>
      <p className="muted" style={{ margin: 0 }}>{c.body}</p>
      <div><Link className="btn btn-primary" href={c.out.href}>{c.out.label}</Link></div>
    </div>
  );
}
```
(React escapes the id; it's rendered as text, never as HTML.)

### `src/app/requests/[id]/not-found.tsx` (new)
```tsx
// Unknown request id: name it, say "request", link to a page that exists in demo and live.
import { MissingRequest } from "@/components/requests/MissingId";
import { isDemoMode } from "@/lib/mode";

export default function RequestNotFound() {
  return <MissingRequest demo={isDemoMode()} />;
}
```

### `src/app/requests/payments/[key]/not-found.tsx` (new)
```tsx
import Link from "next/link";
import { isDemoMode } from "@/lib/mode";
import { paymentNotFoundCopy } from "@/lib/requests/states";

export default function PaymentNotFound() {
  const c = paymentNotFoundCopy(isDemoMode());
  return (
    <div className="page" data-testid="not-found">
      <h1 style={{ margin: 0 }}>{c.title}</h1>
      <p className="muted" style={{ margin: 0 }}>{c.body}</p>
      <div><Link className="btn btn-primary" href={c.out.href}>{c.out.label}</Link></div>
    </div>
  );
}
```
Existing classes only (`.page`, `.panel`, `.panel-b`, `.muted`, `.btn`, `.btn-primary`); no new token;
text in `.muted` (passes AA), never `.faint` (A1). Total ≈ 150 changed lines incl. tests.

Copy check vs `error-messages.md` and PRODUCT_FACTS: says what happened + what to do + what did not
change ("no request, decision or posting was touched" — true: a failed read changes nothing); no codes,
"please", "sorry", "invalid"; no product claim. Demo wording only in demo mode.

## Approval-only?
**No**: new error/not-found screens only; no posting, amounts, auth, pricing copy, customer data or
deletions. Visual → lead-designer review comment before code review; then `CODE REVIEW: APPROVE <head>`
and `QA: PASS <head>`.

## How I'd test it (NOT RUN)
1. **Unit (failing first):** `npx vitest run tests/states.test.ts` → red (module missing) → add
   `states.ts` → green; then full `npx vitest run`.
2. **Error state, real build** (`measuring.md` §3, scratch only): prod build of the branch with
   `DEMO_MODE=on … DESK_DATA_DIR=$SC/desk next start -p 3300`, reset the demo, then
   `cp $SC/desk/requests.json $SC/requests.bak && echo '{broken' > $SC/desk/requests.json` and shoot
   `/requests`, `/requests/all`, `/requests/DEMO-1042`, `/requests/payments/<key>` with `state-shot.cjs`
   at 1280 and 390. Expect: sidebar + Demo data badge visible, "This page couldn't load", Try again,
   "Go to At a glance" (or "Go to Books" on `/requests`); no "Application error"/"Digest" text.
   Playwright: `document.activeElement` is the h1 after load; Tab → Try again → link; Enter/Space work.
   Then `cp $SC/requests.bak $SC/desk/requests.json`, press Try again: the real page renders (proves
   refresh + reset). Restore always, never on real data.
3. **Not found:** `/requests/NOPE-1` and `/requests/payments/nope` in demo, and again on a second
   server with `DEMO_MODE=off` (port 3301, empty desk): copy per mode, link hrefs `/requests/all` and
   `/requests/all?view=attention` resolve 200. Record the HTTP status honestly (expected 200, see limit).
4. **a11y:** `measure.cjs` axe at 1280/390 on the error and not-found pages: 0 new serious/critical;
   `reflow-dark.cjs` 320 px; dark-theme pass. Not checked: screen reader (none in the container).
5. **Load:** `measure.cjs … 5 /requests /requests/all /requests/DEMO-1042` base vs head (error.tsx is a
   client chunk; expect ~no change, report the numbers).
6. **Regression:** `BASE=http://127.0.0.1:3300 python tests/e2e/demo_cases.py` passes;
   `npx tsc --noEmit`, `npx next build`, `npm run lint`.

## PR body (short form of playbook §6)
Branch `ui/request-error-notfound-20261102`. What/why (F3, F4); AC list above; Approval-only: no;
Tests: vitest red→green output, e2e result; Load time table base 0c7d9f1 vs head (n = 5, not run yet);
Accessibility: axe before→after, focus lands on the h1, keyboard order, 320 reflow, not checked: screen
reader/200 % zoom; States: error + not-found screenshots at 1280/390 with the demo badge visible; Copy
check vs error-messages.md; Known limit: HTTP 200 on not-found (root loading.tsx streams) — roadmap row
proposed; Checks; Changelog: "When a request page can't load, you now see a plain message with Try again
and a way back, instead of a technical error; an unknown request ID now says so and links to All requests."

## Follow-ups I'd write as `proposed` roadmap rows (not in this PR)
- Root `src/app/error.tsx` for `/books`, `/inbox`, `/payments` (same copy function, generalised).
- Root `not-found.tsx` also catches unknown URLs like `/foo` and says "Case not found… Back to the
  queue" (queue hidden in demo): fix its copy.
- F5: `requests/loading.tsx` "Loading requests" (separate PR).
- HTTP 404 on not-found (root `loading.tsx` streaming).
