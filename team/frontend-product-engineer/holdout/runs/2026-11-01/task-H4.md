# Holdout run 2026-11-01: frontend-product-engineer

## H4. Review comment on PR #62 (FPE-4)

(This is the comment I would post as the owner of the controller screens. It is not the `CODE REVIEW:` verdict, which only code-reviewer signs, nor `QA: PASS`. Code facts were read this run on `main` @ `0c7d9f1` `[VERIFIED: code read]`. The PR diff is the fixture.)

---

**SCREEN OWNER REVIEW: CHANGES REQUESTED, do not merge.**
`APPROVAL-ONLY: needs Aashmiin's merge`. This changes how posting amounts are displayed and adds a reject action on the posting flow. It is not "UI-only, no logic touched". It must not go through the 06:17 gate.

— frontend-product-engineer · 2026-11-02 SGT

### Blockers (money and honesty)

**1. Amounts are rounded to whole dollars in the posting preview.**
`Math.round(Number(l.amount)).toLocaleString()` shows what will post to Xero rounded to the dollar, so 1,249.50 shows as "1,250". It also passes a decimal string through a float, and it uses locale separators, so a German browser shows "1.250". A controller approving on that screen would approve a figure that is not what posts.
- Rules broken: my never-do ("never change, round, recompute… an amount… in the Xero entry preview"); code-review line 2 (no floats on amounts); OPERATING_MODEL §2 (money amounts are approval-only).
- **Fix:** render `formatUsdc(l.amount)` from `src/lib/requests/lifecycle.ts`, exactly as `BooksPanel.tsx:34` already does.
- "Too many decimals" from the persona: `formatUsdc` shows the exact decimal with trailing zeros trimmed, never fewer than 2 places (`lifecycle.ts:77-81`). Posting lines are cents, rounded down in `rules.ts` (`toCents`), so they normally show 2 places. If it should show fewer, that is a `needs decision` row for accounting-integrations-engineer and Aashmiin, not a component change.

**2. The lines are already shown, and this duplicates them with the wrong shape.**
`BooksPanel.tsx:28-40` already renders the plan in a `<table data-testid="posting-lines">` with Line / USD / Account / Detail headers, using `formatUsdc` and `planPosting` output. The PR's premise ("controllers can't see the lines") isn't true on `main`.
- The new `Line` type (`account`, `currency`) doesn't match lib's `PostingLine` (`accountCode`, `kind`, `amount`, `description`; `types.ts:41-49`).
- The diff doesn't update the one call site (`BooksPanel.tsx:72` passes no `lines`), so as shown it shouldn't typecheck. Please confirm CI ran on this exact head.
- **Fix:** drop the second table and keep the BooksPanel one.

**3. The Reject call goes to an endpoint that doesn't exist and fails silently.**
- There is no `src/app/api/accounting/[id]/reject` route. Only `[id]/route.ts`, `import`, `xero/connect` and `xero/callback` exist.
- `reject()` has no try/catch, no `r.ok` check and no message, so the controller thinks they rejected and nothing was recorded.
- It also sends no `actor` (every action must record who; `ActingAs`), no `content-type`, and accepts an empty reason.
- A new reject state on a posting plan is a posting-rules change. It needs a spec and an API from accounting-integrations-engineer, and it is approval-only.
- **Fix:** take Reject out of this PR. When it comes back:
  ```tsx
  if (!reason.trim()) { setMsg({ ok: false, text: "Add a reason first: it's kept in the audit log." }); reasonRef.current?.focus(); return; }
  try {
    const r = await fetch(`/api/accounting/${encodeURIComponent(requestId)}/reject`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ actor, key: planKey, reason }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? { ok: true, text: j.message } : { ok: false, text: j.error ?? "That wasn't recorded, and nothing was posted. Reload the page and try again." });
  } catch { setMsg({ ok: false, text: "The server didn't answer, so we can't tell if the rejection was recorded. Nothing was posted. Reload to check." }); }
  ```

**4. The confirm copy over-states what happens in demo, and the plural reads badly.**
"Post {n} line(s) to Xero?" is false in demo, where it posts to the simulated demo books. The button label already says "the books" when `provider === "demo"` (`BooksPanel.tsx:72`). Xero is "built, in testing" (PRODUCT_FACTS).
- **Fix:** "Post 2 lines to {the demo books | Xero}?", using the same provider label as the button, with proper plurals.

### Keyboard and ARIA

**5. Approve is a `<div>`, not a button.** (WCAG 2.1.1 Keyboard, 4.1.2 Name, Role, Value.)
`<div className="btn btn-primary" onClick tabIndex={3}>` has no role, and Enter/Space do nothing. Keyboard users can focus it but can't approve. Today `keyboard-flow.cjs` reaches `approve-posting` in 11 Tabs and posts with Enter `[VERIFIED: measured frontend-product-engineer 2026-11-01]`; with this change Enter would do nothing.
- It also drops `disabled={busy || !actor}`, so you can open the confirm with no "Acting as" set (the server then 422s), and you can double-submit.
- It drops the "Approving as … / Set "Acting as" first" hint.
- **Fix:**
  ```tsx
  <button type="button" className="btn btn-primary" ref={approveRef} onClick={() => setConfirming(true)}
    disabled={busy || !actor} data-testid="approve-posting">{busy ? "Posting…" : label}</button>
  ```
  Keep the hint `<span>`. Put it in `.muted`, not `.faint`, until A1 merges.

**6. `tabIndex={3}`.** (WCAG 2.4.3 Focus Order.)
A positive tabindex pulls this control ahead of everything with tabindex 0 on the page, before the verdict and the lines. **Fix:** remove it, because a native button is in order already.

**7. The Reject control is an unlabelled, unfocusable icon.** (WCAG 2.1.1, 4.1.2, 2.5.8 Target Size.)
A `<span>` with `onClick` can't be reached by Tab. `title="Reject"` is not a reliable accessible name and is invisible to keyboard and touch users. The 16×16 target is under 24×24, and the SVG isn't hidden from assistive tech.
- **Fix:** `<button type="button" className="btn">Reject</button>`, a text label (it's a decision, so make it obvious), with `aria-hidden="true"` on any icon.

**8. The confirm "modal" isn't a dialog.** (WCAG 2.1.2, 2.4.3, 4.1.2; APG Modal Dialog pattern.)
- There is no `role="dialog"`, no `aria-modal="true"` and no `aria-labelledby`, so a screen reader doesn't know a dialog opened.
- There is no focus containment, so Tab walks out behind the backdrop.
- Esc does nothing.
- Focus isn't returned to Approve on Cancel or close. The APG says focus moves into the dialog, Tab stays inside, Esc closes, and focus returns to the invoking control `[VERIFIED: frontend-product-engineer 2026-11-01, w3c/aria-practices source, dialog-modal-pattern.html]`.
- **Bug:** the backdrop's `onClick={() => setConfirming(false)}` also fires for clicks *inside* the modal, because the event bubbles. Clicking "Yes, post" therefore starts `go()` and unmounts the dialog at the same moment.
- `autoFocus` on "Yes, post" puts the irreversible choice under Enter.
- "Yes, post" isn't disabled while busy.
- The `.modal`, `.modal-backdrop`, `.icon-btn`, `.row-selected`, `.posting-preview` and `.actions` classes don't exist in `globals.css` (`grep` found none). That makes them new components with no lead-designer spec.
- **Fix:** use the native `<dialog>` element with `showModal()`. It gives the modal behaviour, Esc and inert background for free. `aria-labelledby` points at the question, initial focus goes to **Cancel** (the safe choice), focus returns to Approve on close, and "Yes, post" gets `disabled={busy}`. Ask lead-designer for the dialog spec and tokens first (playbook §5).
  ```tsx
  <dialog ref={dlg} aria-labelledby="post-q" onClose={() => approveRef.current?.focus()}>
    <p id="post-q">Post {n} {n === 1 ? "line" : "lines"} to {where}?</p>
    <button type="button" className="btn" autoFocus onClick={() => dlg.current?.close()}>Cancel</button>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={go}>Yes, post</button>
  </dialog>
  ```

**9. The reject reason input has no label.** (WCAG 3.3.2, 4.1.2, 1.4.3.)
It uses only `placeholder="Reason"`, which disappears on typing and uses `--text-3`, which fails contrast (A1: 3.32:1). **Fix:** a visible `<label>` or `aria-label="Reason for rejecting"`, plus `required` and the error-next-to-field pattern.

**10. The result message is no longer announced, and colour alone tells success from failure.** (WCAG 4.1.3 Status Messages, 1.4.1 Use of Color.)
- `role="status"` was removed.
- Success and failure differ only by `var(--green)` / `var(--red)`.
- The `Failed (${r.status}).` fallback is still there (`error-messages.md`: fix).
- **Fix:**
  - success → `<div role="status" tabIndex={-1} ref={msgRef}>`;
  - failure → `role="alert"`, with text that says what happened and what didn't change ("Nothing was posted");
  - use `<Status>` (icon + text);
  - after the action, `msgRef.current?.focus()`. This also closes baseline finding F2, where focus fell to `<body>` after posting.

**11. Focus indicator removed.** (WCAG 2.4.7 Focus Visible.)
`<style>{'.posting-preview .btn:focus { outline: none; }'}</style>` kills the only focus ring on the most consequential button on the screen. It also injects a style tag, where our convention is `globals.css` only. **Fix:** delete it. The global `:focus-visible` outline stays.

**12. Clickable table rows.** (WCAG 2.1.1, 1.3.1.)
`<tr onClick>` selection is mouse-only, has no `aria-selected`, and selecting does nothing. The table has no `<thead>`/`<th>`, and it isn't inside `.table-wrap`, which would add a 1.4.10 reflow risk on top of F1. `key={i}` also uses the array index. **Fix:** remove selection. With item 2 the table goes away anyway.

### Process
13. The author says "fine for the 06:17 merge gate once reviewed". It isn't. It touches money display and posting (approval-only), adds new components with no lead-designer spec or review, and has no tests.
    - There are no lib changes to unit-test, but the PR needs `keyboard-flow.cjs`, axe at 1280/390, and screenshots at 1280 and 390 with the demo label visible.
    - It needs a measured load table (n = 5) for `/requests/DEMO-1042` and a CHANGELOG line.
    - It needs a spec with acceptance criteria and the demo-mode and real-mode checks stated.
14. **Suggested split:**
    - (a) A small a11y PR on the existing `ApprovePosting`: focus to the result message, `role="status"`/`"alert"`, plain error copy. I can take it. It is still approval-only, because it is the posting component.
    - (b) Confirm dialog: lead-designer spec, then build.
    - (c) Reject: accounting-integrations-engineer spec and API first.
    - (d) Amount display: a decision row, not a UI change.
15. **A nearby catch on the same panel**, not in this diff: `rules.ts:88` returns the reason "Only USD invoices are posted automatically for now". BooksPanel shows this reason. "Posted automatically" contradicts "posts only after a person clicks Approve" (PRODUCT_FACTS) `[VERIFIED: code read]`. Suggested: "Only USD invoices can be posted from Clearline for now." That is a lib string owned by accounting-integrations-engineer, and the change is approval-only. I would add a roadmap row for it.

Once 1–4 are out of this PR and 5–12 are fixed, I'll re-review. I'll also run `keyboard-flow.cjs` and `measure.cjs` on the new head, and post the numbers.
