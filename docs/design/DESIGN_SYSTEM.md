# Clearline design system

One identity for the **website** (`marketing/`) and the **product console** (`/clearline`, `/clearline/trial`, `/clearline/docs`). The console uses the same tokens, more restrained and more data-dense.

- **Token file:** `marketing/app/tokens.css` (CSS custom properties, `--cl-*`). The console copies this file verbatim. Change a value here and in the token file in the same PR.
- **Status:** draft v1, 13 Nov 2026, website workstream. Founder approval pending.
- **Contrast:** every ratio below was computed from the hex values with the WCAG 2.x relative-luminance formula. A ratio is not an "AA" claim until the rendered page has been checked.

## 1. Principles

1. **Evidence first, status second.** Never let one badge stand for three facts: execution, settlement and reconciliation (see §8).
2. **Say the stage.** Every product surface carries one of four stage labels (§9). Never use "live", "production" or "enterprise-ready".
3. **Real data shapes, fictional data.** Tables use the test-mode engine's actual fields and values (`src/lib/clearline/core.ts`). No invented metrics, logos, testimonials, customers, team members or partners, even as placeholders.
4. **Minimal decoration.** No gradients, glows, stock imagery, 3D or fake dashboards. Use rules, whitespace, one accent colour and type.
5. **Credible to a CFO, CTO or payment-ops lead.** Precise numbers (two decimals, currency code, tabular figures), plain sentences, sources named.

## 2. Colour

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--cl-ink` | #17212D | Midnight ink. Text, primary dark surface | 14.42:1 on ivory, 16.26:1 on white |
| `--cl-ivory` | #F5F1E8 | Warm ivory. Page background | — |
| `--cl-signal` | #D04B31 | Signal orange-red. **Accents, rules, markers and large text only** | 3.94:1 on ivory, 4.44:1 on white: **fails AA for normal text** |
| `--cl-signal-strong` | #A93A24 | Signal for small text, links, primary button fill, focus ring | 5.62:1 on ivory; white text on it 6.33:1 |
| `--cl-signal-on-ink` | #F08A6E | Signal as text on ink | 6.63:1 on ink |
| `--cl-bluegrey` | #E6EDF0 | Cool blue-grey. Secondary surface, explanation and info areas | — |
| `--cl-white` | #FFFFFF | Raised surfaces: tables, panels, inputs | — |
| `--cl-line` | #DED6C9 | Decorative dividers only (1.28:1, not a UI boundary) | — |
| `--cl-line-strong` | #8C8478 | Input and control borders | 3.69:1 on white (UI ≥ 3:1) |
| `--cl-quiet` | #63707A | Secondary text on ivory/white only | 4.51:1 ivory, 5.09:1 white; **4.30:1 on blue-grey (fails)** |
| `--cl-muted` | #5A6670 | Secondary text on any light surface | 5.22:1 ivory, 4.97:1 blue-grey |
| `--cl-sand` | #EFEBE2 | Table header, neutral fill | — |
| `--cl-ink-2` | #222E3B | Raised surface on ink | — |
| `--cl-on-ink` / `--cl-on-ink-muted` | #F5F1E8 / #B7C2CA | Text on ink | 14.42:1 / 8.97:1 |

**Signal red rule:** `#D04B31` is never used for text under 24px (or 18.66px bold). Use `#A93A24` instead. White text on `#D04B31` is 4.44:1 and also fails, so the primary button fill is `#A93A24`.

### Semantic tones (text on its tint, all ≥ 4.5:1)

| Tone | Text | Tint | Ratio | Meaning |
|---|---|---|---|---|
| success | #2E6A4B | #E3EFE7 | 5.42:1 | Done and evidenced |
| warning | #7A4F0E | #F6EBD3 | 6.01:1 | Waiting on a person or a source |
| danger | #A93A24 | #F8E3DC | 5.13:1 | Failed, returned, exception |
| info | #2C5A7A | #E6EDF0 | 6.22:1 | In progress, matched, verified evidence |
| neutral | #3B4650 | #EFEBE2 | 8.11:1 | Created, quoted, not_started |

Colour is never the only signal: every status carries its text label, and the three status families also differ in shape (§8).

## 3. Type

Inter (400/500/600) for text, JetBrains Mono (400/500) for identifiers, amounts, labels and code, both self-hosted via `@fontsource`. Georgia italic is used **only** as the accent phrase inside website headings (`<em>`), never in the console.

| Token | Size | Website use | Console use |
|---|---|---|---|
| `--cl-text-xs` | 12px | Mono labels, captions, status tags | Table meta, tags |
| `--cl-text-sm` | 14px | Table cells, buttons, small body | Default body and table text |
| `--cl-text-md` | 16px | Body | Form inputs |
| `--cl-text-lg` | 20px | Lede, h3 | Section title |
| `--cl-text-xl` | 28px | — | Page title (max) |
| `--cl-text-2xl` | 40px | h2 | not used |
| `--cl-text-3xl` | 56px | h1 (clamped down to 36px on phones) | not used |

Line height 1.1 (display), 1.3 (headings), 1.6 (body). Tracking −0.035em on display, −0.02em on headings, +0.08em on uppercase mono labels. Sentence case everywhere. Prose max 68ch. Amounts: mono, tabular figures, right-aligned, currency code first (`SGD 48,215.37`).

## 4. Spacing, layout, breakpoints

4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96 (`--cl-space-1` … `-9`). Website sections 64px (96px ≥1024). Console sections 24–32px.

Container max 1200px. Side gutter **16px** on phones, 32px ≥640, 40px ≥1024.

| Name | Min width | Notes |
|---|---|---|
| base | 0 | Phones, test at 390 and 320 |
| sm | 640px | Two-column record details |
| md | 768px | Header actions appear; 2-column grids |
| lg | 1024px | Hero split, architecture diagram horizontal |
| xl | 1200px (header) / 1280px | Full desktop nav (website) |

The page never scrolls horizontally. Wide tables scroll inside a focusable region (`role="region"`, `tabindex="0"`, `aria-label`).

## 5. Borders, radii, elevation

- Borders: 1px `--cl-line` for dividers; 1px `--cl-line-strong` for anything interactive.
- Radii: 3px tags and code, 6px buttons/inputs/panels/tables, 10px reserved for large website panels. Pills (999px) only for stage and evidence tags.
- Elevation: none by default. `--cl-shadow-overlay` only for menus and toasts. No glow, no gradient, no decorative shadow.

## 6. Buttons and links

| Variant | Fill / text | Use |
|---|---|---|
| Primary | `#A93A24` / white (6.33:1) | One per view: the main action |
| Secondary | transparent, 1px ink border / ink | Second action |
| On ink | ivory fill / ink, or ivory outline | Dark bands |
| Console dense | height 32px, 14px text | Toolbars, row actions |

Height 44px on the website (32px minimum in the console; WCAG 2.2 target size 24px is met either way). External links open in a new tab, show `↗`, and include "(opens in a new tab)" for screen readers. Text links: `#A93A24`, underlined.

**Focus:** 3px solid `#A93A24` outline, 3px offset, on every interactive element (`#F08A6E` on ink). Never remove it.

## 7. Forms

Label above field, 14px/500. Input 44px high, 1px `#8C8478` border, white fill, 16px text (prevents iOS zoom). Errors: text under the field in danger tone, with what to do next, linked via `aria-describedby`. Required fields are marked in text, not colour alone.

Website rule: **no form is shown unless its processor is configured** (Formspree ID). Otherwise show the email address. Never claim a message was sent unless the processor returned success. Never ask for payment records, beneficiary details, statements, credentials or keys.

## 8. Status indicators: three separate dimensions

Names match the tested sandbox engine (`src/lib/clearline/types.ts`): `intent.status = { execution, settlement, settlementScope, reconciliation }`. There is no combined status, and they never share a style.

| Dimension | Values | Style | Why this shape |
|---|---|---|---|
| **execution** (`ExecutionState`) | created, quoted, approved, submitted, in_transit, provider_reported_completed, awaiting_information, on_hold, failed, returned, cancelled, expired | Tinted rounded tag, mono 12px, snake_case value | "What the state machine / provider says" |
| **settlement** (`SettlementEvidenceState` + `SettlementScope`) | none ○, observed ◇, pending_finality ◇, verified ◆, contradicted ✕; scope provider_report · bank_statement · onchain_transfer shown after the value | Outlined pill with a shape marker. **Dashed** = not verified (none, observed, pending_finality). **Solid** = verified or contradicted | Reads as "how much do we actually know, and from what" |
| **reconciliation** (`ReconciliationState`) | not_started, pending, matched, partially_matched, exception | Square tag, 3px left rule, mono uppercase | Reads as a ledger mark |

Tone mapping. execution: created/quoted/approved/cancelled/expired neutral; submitted/in_transit/provider_reported_completed info (a provider claim is never shown as success); awaiting_information/on_hold warning; failed/returned danger. settlement: none muted; observed/pending_finality warning (dashed); verified info (solid); contradicted danger (solid). reconciliation: not_started/pending neutral; matched success; partially_matched warning; exception danger.

Rules (enforced by the engine, mirrored by the UI):
- A provider "completed" report sets execution `provider_reported_completed` and never, on its own, settlement `verified` or reconciliation `matched`.
- A full-amount bank-statement match sets settlement `verified` with scope `bank_statement`. Always show the scope: it proves the payout left the account, not that the beneficiary was credited.
- A provider settlement report or a partial bank line gives at most `observed`. An on-chain transfer is `verified` only past the finality threshold and never proves a bank credit.
- A provider-reported return sets reconciliation `exception` immediately. Show `returnStatus` (`provider_reported` → `confirmed_by_statement`) as a separate mono label next to the reconciliation tag; a confirmed return is still an exception until a person resolves it.
- Exceptions always show their owner and `dueDate` (mono, ISO date); overdue items use the danger tone.
- Each tag includes visually hidden text naming its dimension ("Settlement evidence: …").

Implementation: `marketing/components/Status.tsx` (`.st-exec`, `.st-settlement` + `.stl-*`, `.st-recon`).

## 9. Stage labels

Exactly four, always with text and a distinct dot:

| Label | Dot | Tone | Meaning |
|---|---|---|---|
| Working synthetic engine | filled circle | success | Code runs and is tested, on fictional data |
| Illustrative UI | filled circle | info | Screens exist; data and some behaviour are illustrative |
| In development | hollow circle | warning | Being built (e.g. onchain on testnet) |
| No third-party integration | square | neutral | No real provider, bank or wallet connected |

## 10. Tables

White surface, 1px line border, 6px radius. Header: sand fill, mono 11px uppercase, `scope="col"`. Cells 10×12px padding (console: 8×10px, row height ≥32px). Numbers right-aligned, mono, tabular. IDs and references mono 12px, no wrap. A caption under every table states the source and that data is fictional. Never truncate an amount.

## 11. Timeline

Vertical 1px rule; 7px ink dot per event, signal dot on the latest. Each row: time (mono, `SGT`), event label (600), then `source · evidence label` in caption style. Every event names its provenance (provider API response, provider webhook, bank statement line, synthetic chain observation) and the engine's processing outcome (applied, duplicate_ignored, rejected_signature, stored_late_no_regression…).

## 12. Toasts, empty, error and loading states

- **Toast:** bottom-right in the console (inline on the website), white or tone tint, 3px left rule in tone, overlay shadow, `role="status"` (success/info) or `role="alert"` (error). Auto-dismiss only for success after ≥5s; errors stay until dismissed.
- **Empty:** one sentence saying why it is empty and one next action. Example: "No exceptions. Reconciliation found a match for every settlement line in this file." Never decorative illustrations.
- **Error:** what happened, in plain English, and what to do next. Example: "That transition is not allowed: a created payment cannot jump to completed. Price it first." Keep the user's input.
- **Loading:** skeleton rows at real row height for tables (no spinners over 300ms without text); `aria-busy="true"` on the region; for >2s add "Loading payments…". Respect `prefers-reduced-motion` (no shimmer).

## 13. Website vs console

| | Website | Console |
|---|---|---|
| Headings | Up to 56px, Georgia italic accent | Max 28px, Inter only |
| Density | Generous (64–96px sections) | Dense (24–32px), 14px body |
| Surfaces | Ivory, white, blue-grey, ink bands | Ivory page, white panels; ink only for the top bar |
| Accent | Signal rules and accent phrases | Signal only for focus, primary action and TEST MODE label |
| Mode label | Stage labels per section | Persistent "TEST MODE · FICTIONAL DATA" in the top bar |

## 14. Accessibility checklist (per page)

Skip link; one `h1`; landmarks (`header`, `nav` with labels, `main#main`, `footer`); visible focus; keyboard reaches the main CTA; `aria-current="page"` in nav; images have alt text; no information by colour alone; no horizontal scroll at 320–1440px; reduced motion honoured; contrast pairs from this document only.

## Change log

- 2026-11-13: v1.2. Engine CHANGE 2: returns are reconciliation exceptions with `returnStatus`; exceptions carry due dates.
- 2026-11-13: v1.1. Status dimensions renamed to the tested engine's ExecutionState / SettlementEvidenceState (+ scope) / ReconciliationState; evidence family renamed settlement.
- 2026-11-13: v1. Studio V2 palette consolidated; `#D04B31` restricted to large text/accents; `#A93A24` introduced for small text and buttons; `#5A6670` added for text on blue-grey; three status families and four stage labels defined.
