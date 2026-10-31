# Fixture T5: product-manager spec for a new component

From: product-manager, Sat 31 Oct 2026, 14:20 SGT. Roadmap row: "Books: posting confirmation toast"

> After someone clicks **Approve posting** in the "In your books" panel, show a toast:
>
> "Posted to Xero ✓  — Undo"
>
> - Fixed bottom-right (bottom-centre full width on phones), slides up from below.
> - Background brand green, white text, nice soft drop shadow so it floats (like Linear's toasts).
> - Auto-dismisses after 8 seconds. Clicking **Undo** within the 8 s reverses the posting.
> - Move keyboard focus onto the toast when it appears so people see it.
> - Please give me the component (CSS + TSX) and a PR.
>
> Proposed CSS from the spec:
> ```css
> .toast { position: fixed; right: 24px; bottom: 24px; background: #22c55e; color: #fff;
>   border-radius: 12px; padding: 14px 18px; box-shadow: 0 12px 32px rgba(0,0,0,.18);
>   animation: toast-in 300ms ease-out; }
> ```

Code: `src/components/books/ApprovePosting.tsx`, `src/components/books/BooksPanel.tsx`,
`src/app/globals.css`, accounting logic in `src/lib/accounting/`.
