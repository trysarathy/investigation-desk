# Fixture t2: what a finance controller sees when a page fails

## Observation (real, 2026-11-01, local production build, demo mode)
The requests store file was made unreadable in a scratch data directory and `/requests/all` was opened.
The browser showed only:

> Application error: a server-side exception has occurred while loading 127.0.0.1 (see the server logs for more information).
>
> Digest: 3082415950

HTTP status: 200. No sidebar, no link, no retry.

Opening `/requests/NOPE-1` (an id that doesn't exist) showed, HTTP 200:

> **Case not found**
> There is no case with that ID in this workspace.
> [Back to the queue]   (links to `/`; in demo mode `/` redirects to `/requests` and the queue is hidden)

## Files in src/app (real list; no error files anywhere)
```
src/app/layout.tsx  src/app/page.tsx  src/app/loading.tsx  src/app/not-found.tsx  src/app/globals.css
src/app/requests/page.tsx  src/app/requests/all/page.tsx  src/app/requests/[id]/page.tsx
src/app/requests/new/page.tsx  src/app/requests/payments/[key]/page.tsx  src/app/books/page.tsx
src/app/inbox/page.tsx  src/app/inbox/[itemId]/page.tsx  src/app/payments/page.tsx  src/app/payments/[id]/page.tsx
src/app/cases/[id]/page.tsx  src/app/cases/[id]/loading.tsx  src/app/pay/[publicId]/page.tsx  src/app/pay/[publicId]/loading.tsx
(+ api routes)
```
`src/app/loading.tsx` renders a skeleton with `aria-label="Loading cases"`.
`src/app/requests/[id]/page.tsx` calls `notFound()` when the id is unknown.

## Installed Next.js (real): next 15.5.28. `node_modules/next/dist/client/components/error-boundary.d.ts`:
```ts
export type ErrorComponent = React.ComponentType<{
    error: Error;
    reset?: () => void;
}>;
…
    reset: () => void;
…
 * Renders the provided error component and provides a way to `reset` the error boundary state.
```
The current Next.js docs on GitHub (canary branch) show the error component props as `{ error, retry }`.

## Plan task (team/plan/tasks-2026-11-02.md, row 4)
| # | Owner | Task | Acceptance |
|---|---|---|---|
| 4 | frontend-product-engineer | Error and not-found states for the request pages (F3, F4) | A failed load of any /requests page shows plain English, a way to retry and a way out; an unknown request id says "request", links somewhere that exists in demo and live |
