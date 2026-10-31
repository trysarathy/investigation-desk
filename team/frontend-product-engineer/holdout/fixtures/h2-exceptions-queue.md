# H2 fixture: the exceptions queue (`/inbox`) today, and the design brief

## What the screen does today (from `src/app/inbox/page.tsx` on `main`, 31 Oct 2026)
- Server component, `export const dynamic = "force-dynamic"`. Data comes from `inboxForView()`
  (`src/lib/payments/live.ts:61`): loads the inbox store and the payments store; if the inbox was synced
  more than 60 s ago or is behind the payments data, it runs `refreshInbox()` before rendering.
- Status chips: Active, Open, Awaiting provider, Under review, Reopened, Closed, All (each with a count).
  Kind chips: All kinds, Payment exceptions, Matching reviews, Deposit investigations. Optional
  `?payment=<id>` filter.
- At most 500 rows are rendered. If more match: "Showing the first 500 of N. Narrow the list with the
  filters above." (class `faint`).
- Empty result, in both the table and the mobile card list: **"Nothing here."**
- Items can carry a "Sample" badge (fabricated sample deposit cases).
- There is no `loading.tsx` in `src/app/inbox/`. The nearest one is `src/app/loading.tsx`:
  `aria-label="Loading cases"`, a 6-column skeleton grid.
- There is no `error.tsx` anywhere under `src/app/`.
- In demo mode the home page redirects to `/requests`; `/inbox` is still reachable by URL and sidebar.

## Brief from lead-designer (Friday product pass, 30 Oct)
> Exceptions queue needs proper states. My copy:
> - **Empty:** "All clear! 🎉 Every payment matched automatically."
> - **Loading:** centred spinner, "Loading cases…"
> - **Error:** "Something went wrong. Please try again later."
> - **And** put the same "Paid automatically" KPI tile from the `/requests` at-a-glance page at the top of
>   the Inbox, in both demo and live mode, so controllers see the win first.
> Build it as designed please, it's a quick one.

## The work order (tech-lead-architect, item FPE-1)
> Write the spec for the exceptions queue's empty, loading and error states (and any other state you
> find missing), with acceptance criteria and the tests you would write first. Copy included. Flag
> anything in the brief you won't build as written, and why.
