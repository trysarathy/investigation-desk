# Standards we build to (sourced)

Labels (company rule 2): `[VERIFIED: <url> opened 2026-11-01]` = the primary source itself was opened
this run by frontend-product-engineer. `[ASSUMPTION: …]` = not opened or secondary. Reusing another
pack's fact keeps its original label with who/date.

**Network note (2026-11-01).** `www.w3.org`, `web.dev`, `nextjs.org`, `nngroup.com`,
`design-system.service.gov.uk`, `linear.app`, `stripe.com`, `vercel.com` did **not resolve** from this
session (DNS refused / proxy). Where the publisher keeps the **same text in its own official GitHub
repository**, that repository was opened instead and is cited (W3C's `w3c/wcag` and
`w3c/aria-practices` are what w3.org is built from; `vercel/next.js/docs` is what nextjs.org renders;
`alphagov/govuk-design-system` is what the GOV.UK site renders; `GoogleChrome/web-vitals` is Google's
own library). These count as primary (the publisher's own source), but the rendered page was not seen.
Ask Aashmiin to allow those hosts; then re-open and keep or flip each label.

## 1. Our role's standard (Aashmiin, 1 Nov 2026) and how each part is defined

| # | Standard | Our measurable definition | Basis |
|---|---|---|---|
| S1 | Every screen loads in under 1 second with demo data | Median of 5 fresh-context navigations, production build, local `next start`, demo day loaded, Chromium 1280×800, 1× CPU: **`loadEventEnd` < 1000 ms AND LCP < 1000 ms**. Report the 4× CPU numbers too. Method: `measuring.md` §1 | House rule, **stricter** than Google's "good" LCP of ≤ 2500 ms: `LCPThresholds` `[ 2500, 4000 ]` [VERIFIED: https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/README.md opened 2026-11-01]. The web.dev Core Web Vitals article (https://web.dev/articles/vitals) was **not opened** (host blocked): [ASSUMPTION: not opened] |
| S2 | WCAG 2.2 AA contrast | Text ≥ 4.5:1, large text (≥ 24 px, or ≥ 18.66 px bold) ≥ 3:1; UI boundaries/focus ≥ 3:1; computed from real hex values and confirmed with axe on the rendered page, both themes | 1.4.3: "a contrast ratio of at least 4.5:1… Large-scale text… at least 3:1" [VERIFIED: https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/contrast-minimum.html opened 2026-11-01]. Large-text definition and 1.4.11 3:1: `[VERIFIED: lead-designer 2026-10-31, w3c/wcag source]` |
| S3 | Full keyboard access | Every action reachable and operable with Tab/Shift+Tab/Enter/Space/Esc/arrows; no trap; visible focus on every stop; focus goes somewhere sensible after an action (never `<body>`); order matches reading order | 2.1.1 Keyboard (A): "All functionality of the content is operable through a keyboard interface…"; 2.1.2 No Keyboard Trap (A); 2.4.3 Focus Order (A): "focusable components receive focus in an order that preserves meaning and operability"; 2.4.7 Focus Visible (AA); 2.4.11 Focus Not Obscured (Minimum) (AA, new in 2.2) [all VERIFIED: https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/keyboard.html, …/20/no-keyboard-trap.html, …/20/focus-order.html, …/20/focus-visible.html, …/22/focus-not-obscured-minimum.html opened 2026-11-01] |
| S4 | Plain-English errors that say what to do next | Every error names what happened and the next step, in the user's words, no codes or "Failed (500)."; field errors next to the field; status changes announced (`role="status"`/`role="alert"`) | 3.3.1 Error Identification (A): "the item that is in error is identified and the error is described to the user in text"; 3.3.3 Error Suggestion (AA): "suggestions for correction are… provided"; 4.1.3 Status Messages (AA): "can be programmatically determined… without receiving focus" [VERIFIED: https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/error-identification.html, …/20/error-suggestion.html, …/21/status-messages.html opened 2026-11-01]. Writing rules: `error-messages.md` |
| S5 | Empty, loading and error states for everything | Each owned screen has: an empty state with the next action; a loading state that names what is loading (route `loading.tsx` or Suspense skeleton); an error state (route `error.tsx` with retry + plain words; `not-found.tsx` per segment) | Next.js `error.js`: "allows you to handle unexpected runtime errors and display fallback UI"; `loading.js`: "show an instant loading state from the server while the content of a route segment streams in" [VERIFIED: https://raw.githubusercontent.com/vercel/next.js/canary/docs/01-app/03-api-reference/03-file-conventions/error.mdx and …/loading.mdx opened 2026-11-01]. **Version note:** canary docs show the prop as `retry`; our Next 15.5.28 types use **`reset`** (`node_modules/next/dist/client/components/error-boundary.d.ts`, read 2026-11-01). Use `reset` on our version |
| S6 | Reflow | No two-dimensional scroll at 320 CSS px (house: also 390); tables scroll inside `.table-wrap` or turn into cards | 1.4.10 Reflow (AA): "without requiring scrolling in two dimensions for… 320 CSS pixels" [VERIFIED: https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/21/reflow.html opened 2026-11-01] |
| S7 | Targets | Pointer targets ≥ 24×24 CSS px or the spacing exception; primary actions 44 px on phone (house) | 2.5.8 Target Size (Minimum) (AA) [VERIFIED: …/sc/22/target-size-minimum.html opened 2026-11-01]; 44 pt: `[VERIFIED: lead-designer 2026-10-31, Apple HIG accessibility JSON]` |
| S8 | Valid semantics | Native HTML first; correct roles/states (`aria-current="page"` for the current filter link, never `aria-pressed` on `<a>`); labelled inputs | 4.1.2 Name, Role, Value (A); 3.3.2 Labels or Instructions (A) [VERIFIED: …/20/name-role-value.html, …/20/labels-or-instructions.html opened 2026-11-01] |
| S9 | Honest UI | Demo always labelled; no fake data presented as real; copy matches `company/PRODUCT_FACTS.md` | Company rule 2; `team/CLAIMS_REVIEW.md` |

## 2. Patterns from the WAI-ARIA Authoring Practices (APG)
[VERIFIED: https://raw.githubusercontent.com/w3c/aria-practices/main/content/… opened 2026-11-01; the
rendered site https://www.w3.org/WAI/ARIA/apg/ was not reachable]
- **Keyboard interface practice** (`practices/keyboard-interface/keyboard-interface-practice.html`):
  "Maintaining visible focus, predictable focus movement, and distinguishing between keyboard focus and
  the selected state"; "If visual changes in response to focus movement are subtle, many users will lose
  track of focus and be unable to operate"; tab sequence follows reading order (left to right, top to
  bottom) and covers all of a section before moving to the next.
- **Alert** (`patterns/alert/alert-pattern.html`): "Dynamically rendered alerts are automatically
  announced by most screen readers"; alerts "do not affect keyboard focus"; "avoid designing alerts that
  disappear automatically"; screen readers don't announce alerts already on the page at load. → Use
  `role="alert"` only for a message inserted after an action that failed; `role="status"` for success.
- **Modal dialog** (`patterns/dialog-modal/dialog-modal-pattern.html`): focus moves into the dialog,
  Tab stays inside, Esc closes, focus returns to the invoking control. Applies to the ⌘K command bar and
  any future confirm dialog (e.g. "Approve and post?").
- **Read me first** ("no ARIA is better than bad ARIA"): `[VERIFIED: lead-designer 2026-10-31, w3c/aria-practices source]`.

## 3. Tools
- axe-core: "With axe-core, you can find **on average 57% of WCAG issues automatically**" and it marks
  some results "incomplete" for manual review [VERIFIED: https://raw.githubusercontent.com/dequelabs/axe-core/develop/README.md opened 2026-11-01].
  So axe = 0 violations is necessary, never sufficient: always add the keyboard pass and look at the screenshots.

## 4. How the best product teams work (benchmark) — labels matter here
| Team / source | What we take | Label |
|---|---|---|
| Linear (method / quality posts, https://linear.app/method) | Speed as a feature; small polished increments; fix quality debt continuously | [ASSUMPTION: not opened, host blocked 2026-11-01; from general knowledge] |
| Stripe (design/engineering posts, e.g. accessible colour systems https://stripe.com/blog/accessible-color-systems) | Contrast as a system property, tokens tested against the standard, not page by page | [ASSUMPTION: not opened, host blocked 2026-11-01] |
| Vercel / Next.js | Route-level `loading.tsx`/`error.tsx`/`not-found.tsx`; measure on a production build | Next.js docs as cited above [VERIFIED via vercel/next.js repo]; "Vercel engineers work this way" [ASSUMPTION] |
| Nielsen Norman Group, error-message guidelines (https://www.nngroup.com/articles/error-message-guidelines/) | Visible, close to the problem, human-readable, constructive (how to fix), preserve the user's input | [ASSUMPTION: not opened, host blocked 2026-11-01; widely cited summary, not checked] |
| GOV.UK Design System, error message | "explain what went wrong and how to fix it"; plain English; no "please", "sorry", "invalid", "oops", error codes; specific, consistent; don't clear the field | [VERIFIED: https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/error-message/index.md opened 2026-11-01] |

Never write "Linear does X" or "Stripe's standard is Y" in a PR as fact; say "[ASSUMPTION: not opened]"
or open the source first.
