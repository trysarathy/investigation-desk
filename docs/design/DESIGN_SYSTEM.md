# Clearline design system

One identity for the **website** (`marketing/`) and the **product console** (`/clearline`, `/clearline/trial`, `/clearline/docs`). Same tokens; the console is lighter and denser.

- **Token file:** `marketing/app/tokens.css` (CSS custom properties, `--cl-*`). The console copies this file **verbatim from that path**. Change a value here and in the token file in the same PR.
- **Version:** v2.2 (palette v2.0 "Midnight & Electric Blue"), 13 Nov 2026, website workstream.
- **Approval:** **Brand direction approved by the founder, Aashmiin Kaur, on 13 Nov 2026:** "approved Midnight & Electric Blue as the long-term visual identity." This covers the palette and identity in §2 and the shared token file. Still **pending** founder sign-off: the v2.2 additions in this document (the revised stage labels in §9, the product-view and disclosure patterns in §15–16) and the remaining items in the change log marked pending.
- **Superseded:** the v1 warm-ivory / signal orange-red palette (`#F5F1E8`, `#D04B31`, `#A93A24`, `#B33D28`) and the earlier green brand direction are retired. Neither may appear in site or console code; a test enforces it for `marketing/`.
- **Contrast:** every ratio below was computed from the hex values with the WCAG 2.x relative-luminance formula and **truncated** to two decimals (never rounded up). A ratio is not an "AA" claim for a page until the rendered page has also been checked (see the audit in the PR body).

## 1. Principles

1. **Three truths, never one badge.** Execution (what the provider reported), settlement evidence (what independent evidence establishes) and reconciliation (whether the records match) are always shown separately (§8). These are the console's words.
2. **Human label first, exact API value second.** "Provider reports completed", then `provider_reported_completed` in mono. Finance users read the first; engineers check the second.
3. **Colour means something financial or it is not used.** Green only for genuinely evidenced success; amber for pending, review or uncertain; red for failed, returned, contradictory or exception; blue for information, navigation and the primary action. **Never blue or green for an unverified financial event** (e.g. a provider's "completed" report).
4. **Say the stage.** Every product surface carries a stage label (§9). Never "live", "production" or "enterprise-ready".
5. **Real data shapes, fictional data.** Tables and the product view use the tested engine's fields and values (`src/lib/clearline/`). No invented metrics, logos, testimonials, customers or partners, even as placeholders.
6. **Restraint.** No gradients, orbs, glows, blurred backgrounds, stock imagery, decorative charts or decorative animation. Motion only confirms a state change or a disclosure, ≤ 140ms, and is off under `prefers-reduced-motion`.

## 2. Colour

### Brand palette

| Token | Hex | Role |
|---|---|---|
| `--cl-midnight` | #101827 | Foundation. Website nav and hero; console sidebar |
| `--cl-blue` | #376BEB | Electric Blue. Primary action fill, focus ring. As text: on white only |
| `--cl-white` | #FFFFFF | Surfaces: sections, panels, tables, inputs |
| `--cl-canvas` | #F8FAFC | Off-white canvas: page background, alternate sections, console workspace |
| `--cl-ice` | #DCE7FF | Ice Blue. Selected row, subtle fill |
| `--cl-slate` | #64748B | Secondary text on white and canvas only |
| `--cl-text` | #17212D | Deep text |

### Accessible variants (exist because a base pairing fails)

| Token | Hex | Replaces | Why |
|---|---|---|---|
| `--cl-blue-text` | #2F5BD0 | Electric Blue as text/link on canvas or ice | #376BEB on canvas is 4.49:1 and on ice 3.78:1 (fail) |
| `--cl-blue-hover` | #2F5BD0 | Primary hover fill | White on it 5.95:1 |
| `--cl-blue-on-midnight` | #8FB0FF | Electric Blue as text, link or focus on midnight | #376BEB on midnight is 3.77:1 (fail for text) |
| `--cl-slate-strong` | #4F5D73 | Slate on ice or any tint | Slate on ice is 3.83:1 (fail) |
| `--cl-on-midnight-muted` | #A9B4C4 | Slate on midnight | Slate on midnight is 3.73:1 (fail) |
| `--cl-line-strong` | #7A889E | Control borders on light surfaces | 3:1 non-text minimum |
| `--cl-midnight-control` | #5B6B85 | Control borders on midnight | 3:1 non-text minimum |

Supporting neutrals: `--cl-midnight-2` #1A2436 (raised panel or code block on midnight), `--cl-midnight-line` #2A3548 and `--cl-line` #E2E8F0 (decorative dividers only, never a UI boundary).

### Contrast table (every text and control pairing in use)

| Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|
| Deep text #17212D | White #FFFFFF | 16.25:1 | 4.5:1 | pass |
| Deep text #17212D | Off-white #F8FAFC | 15.53:1 | 4.5:1 | pass |
| Deep text #17212D | Ice #DCE7FF | 13.09:1 | 4.5:1 | pass |
| Slate #64748B | White | 4.75:1 | 4.5:1 | pass |
| Slate #64748B | Off-white | 4.54:1 | 4.5:1 | pass |
| Slate #64748B | Ice | 3.83:1 | 4.5:1 | **fail** |
| Slate #64748B | Midnight | 3.73:1 | 4.5:1 | **fail** |
| Slate-strong #4F5D73 | Ice | 5.37:1 | 4.5:1 | pass |
| Slate-strong #4F5D73 | Info tint #E8EFFF | 5.79:1 | 4.5:1 | pass |
| Electric Blue #376BEB (text) | White | 4.70:1 | 4.5:1 | pass |
| Electric Blue #376BEB (text) | Off-white | 4.49:1 | 4.5:1 | **fail** |
| Electric Blue #376BEB (text) | Ice | 3.78:1 | 4.5:1 | **fail** |
| Electric Blue #376BEB (text) | Midnight | 3.77:1 | 4.5:1 | **fail** |
| White (button label) | Electric Blue #376BEB | 4.70:1 | 4.5:1 | pass |
| White (button hover) | Blue-hover #2F5BD0 | 5.95:1 | 4.5:1 | pass |
| Blue-text #2F5BD0 | White | 5.95:1 | 4.5:1 | pass |
| Blue-text #2F5BD0 | Off-white | 5.68:1 | 4.5:1 | pass |
| Blue-text #2F5BD0 | Ice | 4.79:1 | 4.5:1 | pass |
| Blue-on-midnight #8FB0FF | Midnight | 8.30:1 | 4.5:1 | pass |
| Blue-on-midnight #8FB0FF | Midnight-2 #1A2436 | 7.27:1 | 4.5:1 | pass |
| White | Midnight #101827 | 17.76:1 | 4.5:1 | pass |
| On-midnight-muted #A9B4C4 | Midnight | 8.47:1 | 4.5:1 | pass |
| On-midnight-muted #A9B4C4 | Midnight-2 | 7.41:1 | 4.5:1 | pass |
| Ice #DCE7FF | Midnight | 14.31:1 | 4.5:1 | pass |
| Success #146C43 | Success tint #E4F4EA | 5.65:1 | 4.5:1 | pass |
| Warning #8A5300 | Warning tint #FEF3D6 | 5.72:1 | 4.5:1 | pass |
| Danger #B42318 | Danger tint #FDE8E6 | 5.59:1 | 4.5:1 | pass |
| Info #2F5BD0 | Info tint #E8EFFF | 5.16:1 | 4.5:1 | pass |
| Neutral #475569 | Neutral tint #EEF2F6 | 6.73:1 | 4.5:1 | pass |
| Focus ring #376BEB (non-text) | White | 4.70:1 | 3:1 | pass |
| Focus ring #376BEB (non-text) | Off-white | 4.49:1 | 3:1 | pass |
| Focus ring #376BEB (non-text) | Ice | 3.78:1 | 3:1 | pass |
| Focus ring #8FB0FF (non-text) | Midnight | 8.30:1 | 3:1 | pass |
| Control border #7A889E (non-text) | White | 3.59:1 | 3:1 | pass |
| Control border #7A889E (non-text) | Off-white | 3.43:1 | 3:1 | pass |
| Control border #5B6B85 (non-text) | Midnight | 3.28:1 | 3:1 | pass |
| Primary button #376BEB (non-text) | Midnight | 3.77:1 | 3:1 | pass |
| Divider #E2E8F0 (decorative) | White | 1.23:1 | none (decorative) | decorative only |

Text minimum 4.5:1 (WCAG 1.4.3); non-text UI and focus indicator 3:1 (1.4.11). Rows marked **fail** are pairings that are **not allowed**; the variant in the previous table is used instead.

### Semantic financial colours

| Tone | Text | Tint | Ratio | Use |
|---|---|---|---|---|
| success (green) | #146C43 | #E4F4EA | 5.65:1 | Genuinely evidenced success only: settlement `verified`, reconciliation `matched` |
| warning (amber) | #8A5300 | #FEF3D6 | 5.72:1 | Pending, review, uncertain: on hold, awaiting information, observed, pending finality, partly matched, awaiting match |
| danger (red) | #B42318 | #FDE8E6 | 5.59:1 | Failed, returned, contradicted, exception |
| info (blue) | #2F5BD0 | #E8EFFF | 5.16:1 | Informational notes, navigation, selected. Never a payment state |
| neutral (slate) | #475569 | #EEF2F6 | 6.73:1 | Created, quoted, approved, cancelled, expired, not started, **and every provider claim** (submitted, in transit, provider reports completed) |

Why provider claims are neutral: a provider's "completed" is a report, not evidence. Green would overstate it, blue would read as "fine", and amber on every healthy payment would cry wolf. The settlement and reconciliation tags beside it carry the evidence colour. Colour is never the only signal: every tag carries its text label, and the three dimensions differ in shape (§8).

## 3. Type

Three families, all self-hosted via `@fontsource` (no external font requests):

- **Newsreader** 400/500 (`--cl-font-display`): website headings only. An editorial serif at display sizes; it gives the site a voice without decoration. Never in the console.
- **Inter** 400/500/600 (`--cl-font-sans`): body, UI, console headings.
- **JetBrains Mono** 400/500 (`--cl-font-mono`): identifiers, amounts, API values, labels, code.

| Token | Size | Website | Console |
|---|---|---|---|
| `--cl-text-xs` | 12px | Mono labels, captions, API values | Table meta, tags |
| `--cl-text-sm` | 14px | Table cells, buttons | Default body and table text |
| `--cl-text-md` | 16px | Body | Inputs |
| `--cl-text-lg` | 20px | Lede, h3 | Section title |
| `--cl-text-xl` | 28px | h2 on phones | Page title (max) |
| `--cl-text-2xl` | 40px | h2 | — |
| `--cl-text-3xl` | 64px | h1 (clamps to 40px at 320px) | — |

Line height 1.04 display, 1.25 headings, 1.6 body. Sentence case. Prose max 66ch. Amounts: mono, tabular figures, currency code first (`SGD 24,651.37`), never truncated.

## 4. Spacing, layout, breakpoints

4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128 (`--cl-space-1` … `-10`). Website sections 64px on phones, 96–128px on desktop. Console sections 24–32px.

Container max 1200px. Side gutter **16px** on phones, 32px ≥ 640, 40px ≥ 1024. Test at 320, 390, 768, 1440. The page never scrolls horizontally; wide tables scroll inside a focusable region (`role="region"`, `tabindex="0"`, `aria-label`).

## 5. Surfaces: website and console

| | Website | Console |
|---|---|---|
| Foundation | Midnight nav and hero | Midnight sidebar (`--cl-nav-bg`) |
| Content | White sections alternating with canvas | Canvas workspace, white panels |
| Primary action | Electric Blue button, one per view | Electric Blue button, one per view |
| Selected | — | Ice row/fill, `--cl-slate-strong` secondary text on it |
| Headings | Newsreader, up to 64px | Inter, max 28px |
| Mode label | Stage labels per section | Persistent "TEST MODE · FICTIONAL DATA" |

Role aliases in the token file (`--cl-page`, `--cl-surface`, `--cl-selected`, `--cl-action`, `--cl-link`, `--cl-text-secondary`, `--cl-nav-*`) let both products bind to roles rather than hex.

## 6. Borders, radii, elevation

1px `--cl-line` for dividers; 1px `--cl-line-strong` for anything interactive. Radii: 4px tags and code, 8px buttons/inputs/tables, 12px large website panels. Elevation: none, except `--cl-shadow-panel` (the product view sitting on midnight) and `--cl-shadow-overlay` (menus, tooltips). No glow.

## 7. Buttons and links

| Variant | Fill / text | Ratio | Use |
|---|---|---|---|
| Primary | #376BEB / white; hover #2F5BD0 | 4.70:1 / 5.95:1 | One main action per view |
| Secondary (light) | transparent, 1px #7A889E border / deep text | 16.25:1 | Second action |
| Secondary (midnight) | transparent, 1px #5B6B85 border / white | 17.76:1 | Second action in the hero |
| Text link (light) | #2F5BD0, underlined | 5.68:1 on canvas | Inline links |
| Text link (midnight) | #8FB0FF, underlined | 8.30:1 | Inline links in the hero and footer |

Height 44px on the website, 32px minimum in the console (WCAG 2.2 target 24px met either way). External links show `↗` and announce "(opens in a new tab)".

**Focus:** 3px solid #376BEB outline, 2px offset, on every interactive element; #8FB0FF on midnight. Never removed.

## 8. Status: three separate truths

Names match the tested engine (`src/lib/clearline/types.ts`): `intent.status = { execution, settlement, settlementScope, reconciliation }`. There is no combined status.

| Dimension | Shape | Question it answers |
|---|---|---|
| **Execution** (`ExecutionState`) | Rounded tag | What the provider reported |
| **Settlement evidence** (`SettlementEvidenceState` + scope) | Pill with a marker: ○ none, ◇ observed / pending finality (dashed border), ◆ verified, ✕ contradicted (solid) | What independent evidence establishes, and its scope |
| **Reconciliation** (`ReconciliationState`) | Square tag with a 3px left rule | Whether the records match |

### Human labels and tones

Labels are the engine's exact `HUMAN_LABELS` strings (`src/lib/clearline/labels.ts`, CHANGE 5), so the website and the console read identically. Change wording in the engine, not here.

| API value | Human label (engine) | Tone |
|---|---|---|
| execution `created` / `quoted` | Created / Quoted | neutral |
| execution `approved` | Approved — not yet sent | neutral |
| execution `submitted` | Sent to provider | neutral |
| execution `in_transit` | Provider reports in transit | neutral |
| execution `provider_reported_completed` | Provider reports completed | neutral |
| execution `awaiting_information` | Provider requests information | warning |
| execution `on_hold` | On hold with the partner | warning |
| execution `failed` / `returned` | Provider reports failed / Provider reports returned | danger |
| execution `cancelled` / `expired` | Cancelled / Expired | neutral |
| settlement `none` | No settlement evidence | neutral |
| settlement `observed` | Settlement observed (not verified) | warning |
| settlement `pending_finality` | Awaiting finality | warning |
| settlement `verified` | Settlement verified | success |
| settlement `contradicted` | Settlement evidence contradicted | danger |
| settlementScope `none` / `provider_report` / `bank_statement` / `onchain_transfer` | No evidence / Provider report only / Bank statement / On-chain transfer (synthetic testnet), shown in brackets after the settlement label | — |
| reconciliation `not_started` | Not started | neutral |
| reconciliation `pending` | Awaiting statement | warning |
| reconciliation `matched` | Matched | success |
| reconciliation `partially_matched` | Partially matched | warning |
| reconciliation `exception` | Needs review | danger |
| advance `supplier_paid` | Supplier paid (provider-reported) — read with `supplierPaidBasis` | neutral |

The exact API value is always shown as secondary detail (mono, slate, after the label) and is named in visually hidden text ("Execution: Provider reports completed, API value provider_reported_completed"). In the website product view (§15), hovering or focusing a truth also highlights the matching field in the API record beside it. Inside a truth the settlement chip carries no scope; the scope is its own line, worded as the console words it.

### Rules (enforced by the engine, mirrored by the UI)

- A provider "completed" report sets execution `provider_reported_completed` and never, on its own, settlement `verified` or reconciliation `matched`.
- A full-amount bank-statement match sets settlement `verified` with scope `bank_statement`. Always show the scope: it proves the payout left the account, not that the beneficiary was credited.
- A bank line with a trusted reference but only part of the amount gives reconciliation `partially_matched` and settlement `observed`; the remainder stays outstanding (`RC_PARTIAL_AMOUNT`). The line carries a structured `amountDifference` (expected, reported, difference, currency, source, required next action).
- A provider settlement report **below** the payout amount raises `unmatched_reconciliation` / `RC_UNDER_AMOUNT_REPORT`: reconciliation `exception` ("Needs review"), settlement not upgraded, and the same structured `amountDifference`. Show expected, reported and difference as mono amounts with the currency, and the required next action as the exception's action.
- A provider settlement report on a payout that is `failed`, `cancelled`, `expired` or `returned` is a contradiction, not evidence: `contradictory_evidence` / `RC_REPORT_ON_TERMINAL_PAYOUT`, reconciliation `exception`, settlement and scope unchanged.
- Funding: `supplier_paid` is labelled "Supplier paid (provider-reported)". Always show `supplierPaidBasis` (`none` · `provider_reported` · `verified_settlement`); only `verified_settlement` may use the success tone.
- A provider settlement report gives at most `observed` and never reconciles on its own. An on-chain transfer is `verified` only past the finality threshold and never proves a bank credit.
- A provider-reported return sets reconciliation `exception` immediately. Show `returnStatus` (`provider_reported` → `confirmed_by_statement`) beside it; a confirmed return is still an exception until a person resolves it.
- Exceptions always show their owner and `dueDate` (ISO date, mono); overdue items use the danger tone.

Implementation: `marketing/components/Status.tsx` (`.st-exec`, `.st-settlement` + `.stl-*`, `.st-recon`, human-label maps exported for the console).

## 9. Stage labels

| Label | Marker | Tone | Meaning |
|---|---|---|---|
| Working synthetic engine | filled circle | success | Code runs and is tested, on fictional data |
| Interactive prototype | filled circle | info | A separate interactive demo (the Funding Desk demo), not the tested engine |
| Design only, not built | dashed hollow circle | warning | A design on paper; no code exists (e.g. Safe payout proposals, evidence fingerprints) |
| No third-party integration | square | neutral | No real provider, bank or wallet connected |

Retired in v2.2: "Illustrative UI" (the console works on the tested engine; calling it illustrative undersold it and blurred what is real) and "In development" (nothing was being built behind the onchain items it labelled; "Design only, not built" says what is true). Never label something "in development" unless code for it exists on a branch.

## 10. Tables

White surface, 1px `--cl-line` border, 8px radius. Header: canvas fill, mono 11–12px uppercase slate, `scope="col"`. Numbers right-aligned, mono, tabular. A caption states the source and that data is fictional. Selected row: ice fill, `--cl-slate-strong` for secondary text.

## 11. Timeline

Vertical 1px rule; 8px dot per event, Electric Blue ring on the latest (navigation emphasis, not a status). Each row: time (mono, SGT), event (600), then `source · outcome` in slate. Every event names its provenance and the engine's processing outcome.

## 12. Toasts, empty, error and loading states

- **Toast:** white, 3px left rule in tone, overlay shadow, `role="status"` (info/success) or `role="alert"` (error). Errors stay until dismissed.
- **Empty:** one sentence on why it is empty and one next action. No illustrations.
- **Error:** what happened in plain English, and what to do next. Keep the user's input.
- **Loading:** skeleton rows at real row height, `aria-busy="true"`, text after 2s. No shimmer under reduced motion.

## 13. Forms

Label above field, 14px/500. Input 44px, 1px #7A889E border, white fill, 16px text. Errors under the field in danger tone, linked via `aria-describedby`. Website rule: no form is shown unless its processor is configured; otherwise show the email address. Never ask for payment records, beneficiary details, statements, credentials or keys.

## 14. Accessibility checklist (per page)

Skip link; one `h1`; landmarks (`header`, labelled `nav`, `main#main`, `footer`); visible focus; keyboard reaches the main CTA; `aria-current="page"`; alt text; no information by colour alone; no horizontal scroll at 320–1440px; reduced motion honoured; contrast pairs from §2 only; axe-core 0 violations at 320, 390, 768 and 1440.

## 15. Product view (website)

The website's large product demonstration is the console's payment investigation page rendered as HTML, not a screenshot or an illustration.

- **Data:** `marketing/lib/investigations.ts`, generated from the tested engine on `rc3/clearline-app` by `marketing/scripts/engine-investigations.gen.ts` (`sampleWorkspace()`, `investigate()`, `evidenceTimelineFor()`, `describeStatus()`, `HUMAN_LABELS`). Never edited by hand; regenerate when the engine's sample changes.
- **Structure and words:** the console's own (`src/components/clearline/pages/Investigation.tsx`): breadcrumb Console › Investigations › reference; A Summary with the engine's one-line status summary; B "Three separate truths — never one badge" (Execution · What the provider reported; Settlement evidence · What independent evidence establishes; Reconciliation · Whether the records match), with the console's scope wording ("by bank statement"); C Evidence timeline, each row marked Independent or Not independent with the engine's processing outcome; D Findings (Who owns the next step, Still unknown, Financially outstanding, Exceptions on this payment).
- **Interaction:** five scenario tabs (`aria-pressed`), and focusing or hovering a truth highlights its field in the API record. No other motion.
- **Timeline rule colours:** green left rule only for independent evidence; amber for exceptions and missing evidence; line colour otherwise.

## 16. Working today / not built disclosure

One source: `marketing/lib/disclosure.ts`, rendered by `<Disclosure />` on Home, Platform and Trial. Two ruled columns (works today in the sandbox · not built yet) with a mono area label per row, and an ice "Out of scope" note. An item may sit under "works today" only if the released engine and console can demonstrate it. Never a card grid.

## Change log

- 2026-11-13: v2.2. Founder approved Midnight & Electric Blue as the long-term visual identity (recorded above). Stage labels revised (§9): Interactive prototype and Design only, not built replace Illustrative UI and In development (pending founder sign-off). Product view generated from the engine with the console's section names (§15); single working-today disclosure (§16). Founder photo shown at its native 120 × 150 px, never upscaled. Screenshots in `screenshots/` (first screens at 1440 and 390 for Home and Developers, plus the product view) are regenerated by `capture-screenshots.cjs`; two runs give byte-identical files.

- 2026-11-13: v2.1. Engine CHANGE 5: status labels are the engine's exact `HUMAN_LABELS`; rules for `RC_UNDER_AMOUNT_REPORT`, `RC_REPORT_ON_TERMINAL_PAYOUT`, the structured `amountDifference` and `supplierPaidBasis`.
- 2026-11-13: **v2.0 Midnight & Electric Blue.** New palette (midnight, Electric Blue, white, off-white, ice, slate, deep text) with accessible variants for every failing pairing; semantic financial colours re-defined (provider claims neutral, never blue or green); human status labels with exact API values as secondary detail; Newsreader display face for website headings. **Supersedes** the v1 ivory / orange-red palette and the earlier green direction.
- 2026-11-13: v1.2. Engine CHANGE 2: returns are reconciliation exceptions with `returnStatus`; exceptions carry due dates.
- 2026-11-13: v1.1. Status dimensions renamed to the tested engine's ExecutionState / SettlementEvidenceState (+ scope) / ReconciliationState.
- 2026-11-13: v1. Studio V2 palette (retired in v2.0).
