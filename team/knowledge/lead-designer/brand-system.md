# Clearline brand system (extracted from the real code)

Every value below was read from the code on 31 Oct 2026 (SGT) at these commits. **[VERIFIED]** means
the file itself was opened; the cite is `branch:file:line`. When a value here and the code disagree,
the code wins and this file is wrong: fix it in the same PR.

| Surface | Source of truth | Commit read |
|---|---|---|
| Website (marketing site) | `origin/pitch-deck:website/src/app/globals.css`, `website/src/components/*.tsx` | `ad15acb` |
| Product UI | `origin/main:src/app/globals.css` (same file on `ai-team`), `src/components/*.tsx` | `8decb27` |
| Pitch deck + mentor briefs | `origin/pitch-deck:pitch/src/deck_style.py` (+ `build_deck10.py`) | `ad15acb` |
| White paper | `origin/whitepaper:whitepaper/style.tex`, `whitepaper/build.py`, `whitepaper/diagrams/*.svg` | `827a0ec` |
| Design intent | `docs/SPEC.md` §9 "Design direction" (lines 359-369) | `ai-team` |

A DTCG-format copy of the tokens is in `tokens.dtcg.json` (same values, for tools). Contrast for every
pair is computed in `accessibility.md` by `tools/contrast.mjs`.

## 1. Two deliberate looks, one family

Clearline has **two visual modes on purpose**. Never blend them.

| | Website, deck, OG image | Product UI, white paper |
|---|---|---|
| Feel | Dark, cinematic, periwinkle glow; "the brand" | Calm, dense instrument; "Linear's speed, Stripe's object pages" (SPEC §9) |
| Canvas | Ink `#0a0c11` (deck `#0b0e14`) | Off-white `#f7f7f5` / white panels (paper: white) |
| Accent | Periwinkle `#8ea2ff` (strong `#6e7df0`) | Blue `#3b5bdb` (dark mode `#6b86f0`); paper uses `#6e7df0` |
| Type | Inter Variable, big tight headlines (deck: Arial) | Inter 13 px body, JetBrains Mono for hashes/amounts (paper: Inter 10 pt) |
| Depth | Soft glow shadows, gradients, grid fade | 1 px borders, no shadows, no gradients (SPEC §9) |
| Radius | Pills (`rounded-full`) and 16 px cards (`rounded-2xl`) | 6 px (`--radius`), 12 px pay card, 999 px pills |

The shared DNA: Inter; one cool blue-violet accent; semantic green/amber/red **only** for evidence
states; sentence case; "fictional data" always labelled; the tick logo.

## 2. Website tokens [VERIFIED `origin/pitch-deck:website/src/app/globals.css:3-18`]

Tailwind v4 `@theme` (so each becomes a utility: `bg-ink`, `text-muted`, `border-line`…). Dark only
(`color-scheme: dark`, line 21; `themeColor #0a0c11` in `layout.tsx:24`).

| Token | Value | Role (from usage in components) |
|---|---|---|
| `--color-ink` | `#0a0c11` | Page background; text on light buttons |
| `--color-panel` | `#11141b` | Cards, browser frame, sections at `/40` |
| `--color-panel-2` | `#161a23` | Raised panel |
| `--color-line` | `rgb(255 255 255 / 0.08)` | Dividers, card borders (≈ `#1e1f24` on ink) |
| `--color-line-strong` | `rgb(255 255 255 / 0.14)` | Button/field/pill borders (≈ `#2c2e32` on ink) |
| `--color-fg` | `#eceef4` | Primary text; primary-button fill |
| `--color-muted` | `#a3abba` | Body copy, sublines, nav |
| `--color-faint` | `#8a93a3` | Footnotes, legal, frame labels, placeholders |
| `--color-accent` | `#8ea2ff` | Eyebrows, links, focus ring, selection tint |
| `--color-accent-strong` | `#6e7df0` | Glows (`rgba(110,125,240,…)`) |
| `--color-good` | `#5fd3a0` | "Working demo" dot, positive state |
| `--color-warn` | `#f5b85c` | Warning state |
| `--color-bad` | `#f28b82` | Error text (`Partners.tsx` form error) |

Other literal colours in components: headline gradient `#c3ccff → #8ea2ff → #7f92ff`
(`Hero.tsx:19`); logo gradient `#b9c4ff → #7f92ff` (`ui.tsx:12-13`, `public/icon.svg`); selection
`rgb(142 162 255 / 0.35)` (`globals.css:45`); glow shadow `0 40px 120px -30px rgba(110,125,240,0.45)`
(`Hero.tsx:41`, `ui.tsx:111`).

**Type (website).** Inter Variable via `@fontsource-variable/inter` 5.3.0, features `cv11`, `ss01`
(`globals.css:4,39`). Scale as used:

| Use | Size / weight / tracking / leading | Cite |
|---|---|---|
| H1 hero | `clamp(38px, 6.2vw, 68px)` / 600 / `-0.04em` / 1.0, `text-balance` | `Hero.tsx:18` |
| H2 section title | `clamp(30px, 4.6vw, 52px)` / 600 / `-0.03em` / 1.05 | `ui.tsx:86-88` |
| Eyebrow | 13px / 600 / uppercase / `0.14em`, accent | `ui.tsx:82-84` |
| Hero subline | `clamp(16.5px, 1.9vw, 19px)`, relaxed, muted | `Hero.tsx:22` |
| Body / FAQ question | 17px (muted) / 17px 500 | `Sections.tsx:10,98` |
| Card body | 15.5px relaxed muted; card title 18px 600 | `Sections.tsx:61-62` |
| Buttons | 15px 600 (primary) / 500 (secondary); header CTA 13.5px | `ui.tsx:66,76,135` |
| Small print | 12-13.5px faint | `Hero.tsx:33,46`, `ui.tsx:172` |

**Spacing and layout (website).** Container `max-w-6xl` (1152px) with `px-5` (20px) on phones and
`sm:px-8` (32px); sections `py-20 sm:py-24` (80/96px); header `h-16` sticky with `bg-ink/75
backdrop-blur-xl` (`ui.tsx:125-126`). Tailwind's 4px spacing scale. Breakpoints: Tailwind defaults
(`sm` 640, `md` 768); the nav is hidden below `md` (`ui.tsx:128`), so phones see logo + "Book a call" only.

**Radii.** Pills/buttons `rounded-full`; cards and frames `rounded-2xl` (16px); form fields
`rounded-xl` (12px) (`Partners.tsx:13`); focus outline radius 6px (`globals.css:51`).

**Motion.** `.rise` hero entrance 0.9s, `.streak` 7s loop, `.drift` 18s loop, `[data-reveal]` 0.7s
scroll reveal, all `cubic-bezier(0.22,1,0.36,1)`; every one is switched off under
`prefers-reduced-motion: reduce` (`globals.css:29-33,71-73,119-122`). Reveal only hides content once
JS has added `.js`, so no-JS users see everything (line 82). Framer Motion was removed for performance
(`website/README.md`). Keep it that way.

**Components (website, `ui.tsx`).** `LogoMark`/`Logo` (7-29), `Reveal` (31-53), `PrimaryButton`
(h-12, pill, `bg-fg text-ink`, arrow icon; 59-72), `SecondaryButton` (h-12, pill, `border-line-strong`;
74-80), `Eyebrow` (82-84), `SectionTitle` (86-88), `Shot` (WebP 1x/2x real screenshots; 90-107),
`BrowserFrame` (three dots + "app.clearline · demo data" label; 109-121), `Header` (123-141),
`Footer` (143-178, "Screenshots and the demo film use fictional companies and amounts"). Form field
class `Partners.tsx:13`; radio "chips" `Partners.tsx:92-95`.

## 3. Product UI tokens [VERIFIED `origin/main:src/app/globals.css`]

Header comment, line 1: "Design tokens from spec section 9. 8px grid, 1px borders, 6px radius, no
shadows." Light (2-25), dark via `prefers-color-scheme` unless `data-theme="light"` (28-49), forced
dark `[data-theme="dark"]` (52-71). A Theme select (System/Light/Dark) sits in the sidebar.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--canvas` | `#f7f7f5` | `#111215` | Page |
| `--panel` | `#ffffff` | `#18191d` | Panels, cards, inputs |
| `--panel-2` | `#fafaf9` | `#1d1e23` | Sidebar, badges, reply box |
| `--text` | `#17181c` | `#ececee` | Primary text |
| `--text-2` | `#5b5e66` | `#a4a7ae` | `.muted`, labels |
| `--text-3` | `#8a8d94` | `#767982` | `.faint`, table headers, eyebrows, placeholders, hints **(fails AA, see accessibility.md)** |
| `--border` | `#e4e4e0` | `#2a2b31` | Panel and row borders |
| `--border-strong` | `#d2d2cc` | `#383a41` | Buttons, inputs, chips |
| `--accent` | `#3b5bdb` | `#6b86f0` | Links, primary button, progress |
| `--accent-text` | `#ffffff` | `#0d1020` | Text on accent |
| `--accent-soft` | `#edf1fd` | `#1e2440` | Progress pill background |
| `--green` / `-soft` | `#1f7a3d` / `#e9f5ec` | `#5cc98a` / `#15291e` | Check passed, paid |
| `--amber` / `-soft` | `#8a5a00` / `#fdf3dc` | `#e8b45a` / `#2e2512` | Needs confirming, waiting, demo flag |
| `--red` / `-soft` | `#b42318` / `#fdecea` | `#f1877d` / `#351a18` | Failed, blocked, contradiction |
| `--focus` | `#3b5bdb` | `#8aa0f5` | Focus ring |
| `--radius` | 6px | | All controls and panels |
| `--sidebar` | 220px | | Sidebar width |
| `--font-ui` | `"Inter", system-ui, -apple-system, "Segoe UI", sans-serif` | | 400/500/600 from `@fontsource/inter` (`src/app/layout.tsx:2-4`) |
| `--font-mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace` | | 400/500 (`layout.tsx:5-6`) |

**Type (product).** Body 13px / 1.5 (`globals.css:76-83`); h1 16, h2 14, h3 13, all 600, `-0.01em`
(88-91); `.mono` 12px tabular (93); table headers 12px 500 `--text-3` (168-171); `.eyebrow` 11px 600
uppercase `0.06em` `--text-3` (365); `.hero h1` 26px (381); `.kpi .v` 24px tabular (392); verdict
title 18px (203); `.amount-big` 28px; pay page amount 40px weight 650 (332). Numbers always
`tabular-nums`. Long values truncated in the middle with copy-on-click and full value on focus
(`.mono-btn`, 228-235; SPEC §9).

**Spacing.** 8px grid: gaps 4/8/12/16/24; `.page` padding `16px 24px 48px` (122); panels 12-16px.
**Breakpoints.** 760px (sidebar becomes a top bar; tables become cards: `.narrow-only`, 254-265,
316-321); 1100px (`.cols` two-column → one, 206).

**Components (product).** `.btn` 32px, `.btn-sm` 26px, `.btn-primary` (126-136); `.input` 32px
(144); `.chip` 28px pill (152-156); `.panel`, `.panel-h`, `.panel-b` (166, 302-304); `.table`
(167-177) with `.table-wrap` horizontal scroll; `.badge` 20px (179); `.pill` 22px with a dot +
state classes `pill-*` (280-288); `.tone-*` and `.tone-box-*` (371-376, 417-422) for the five
states paid / progress / waiting / attention / blocked; `.verdict-bar` (197); `.timeline` (207);
`.cmd` ⌘K palette (238-244); `.demo-flag` / `.demo-badge` (274, 363); pay page `.pay-*` (328-…).
Status is always **text + dot/icon + colour**, never colour alone (SPEC §9).

## 4. Deck tokens [VERIFIED `origin/pitch-deck:pitch/src/deck_style.py:12-16`]

python-pptx, 16:9 at 13.333 × 7.5 in, margin `M = 0.6 in`, blank layout, ink background on every
slide, **Arial** (not Inter: PowerPoint portability; keep it unless Aashmiin decides otherwise).

| Name | Hex | Role |
|---|---|---|
| `INK` | `#0b0e14` | Slide background (note: website ink is `#0a0c11`; 1-step drift, harmless) |
| `CARD` | `#151a24` | Card fill |
| `LINE` | `#2a3140` | Card border 1pt |
| `WHITE` | `#f2f4f7` | Titles, body |
| `MUTED` | `#a3aab6` | Subtitles, secondary |
| `FAINT` | `#767e8c` | 10pt source footers |
| `ACC` | `#8ea2ff` | Pills, highlights (= website accent) |
| `ACC2` | `#b9c6ff` | Tagline, ◦ † markers, label tags |
| `RED` | `#ff8a7f` | Warnings only |

Sizes: title 36pt bold, subtitle 20pt muted (`title()`, 44-46); footer/sources 10pt faint (48-49);
body mostly 18-20pt, big numbers 32-40pt, title slide wordmark 72pt (`build_deck10.py`). Card radius
adjustment 0.08, pill 0.5, no shadows (51-63). Honesty markers on slides: ◦ estimate/assumption,
† untested guess, unmarked = sourced, key in every footer (`build_deck10.py:3-4,12`).

## 5. White paper tokens [VERIFIED `origin/whitepaper:whitepaper/style.tex:1-55`, `build.py:85-87`]

Pandoc → XeLaTeX, A4, margins top 20 / bottom 22 / left-right 22 mm, Inter 10pt, DejaVu Sans Mono,
`\linespread{1.08}`, `\parskip 4pt`, no indent. Line 1 says "Brand: Inter, ink #0a0c11, accent
#6e7df0 (from /website)".

| Name | Hex | Role |
|---|---|---|
| `ink` | `#0a0c11` | Text |
| `accent` | `#6e7df0` | Section rule 0.8pt, title bar 36×3pt, links (**3.59:1 on white: fails as link text**) |
| `accentbg` | `#f4f5ff` | Status box fill |
| `muted` | `#5b6272` | Captions, footnotes, footer, subtitle |
| `rule` | `#c9cdd6` | Table rules |
| `vgreen` / `aamber` / `gred` | `#2f7d5b` / `#a8670f` / `#b23a30` | Review-copy claim tags [VERIFIED]/[ASSUMPTION]/[GUESS] |

Headings: section 15/19pt bold with accent rule under it; subsection 11.5/15pt bold; title 30/34pt,
subtitle 15/19pt muted. Diagrams (`whitepaper/diagrams/*.svg`) use Inter 12-15px, `#0a0c11`,
`#5b6272`, `#6e7df0`, `#a3abba`, fills `#f4f5f8`/`#f7f8ff`/`#eaf7f0`, green `#2f7d5b`.

## 6. Logo [VERIFIED `website/src/components/ui.tsx:6-29`, `website/public/icon.svg`]

"A flat line that turns into a tick (a payment that explains itself)." 32×32 rounded square (rx 8),
linear gradient `#b9c4ff → #7f92ff` top-left to bottom-right, path `M7 16.5h5.2l2.6 3.2L25 9.5`
stroke `#0a0c11` width 3, round caps/joins. Wordmark: "Clearline", Inter 600, 17px, tight tracking,
2.5 (10px) gap after a 28px mark. Deck uses `pitch/assets/icons/logo.png` (rendered from the same mark).

Usage rules (ours, 31 Oct): keep the mark on ink or white only; min 16px (favicon) / 24px in UI;
clear space ≥ ¼ of the mark's width; never recolour the tick, add effects, stretch, or place it on a
photo; never put any **other** company's logo next to it unless that company has agreed in writing
and Aashmiin approved (no "trusted by", "as seen in" or partner strips: company rule 2).

## 7. Voice inside the design (from SPEC §9 and the site)

Sentence case; short verdicts ("Arrived on-chain, not credited"); no exclamation marks; no blame
("The funds went to…"); every demo surface says "demo data" / "fictional"; claims carry their honesty
marker. A design that needs a number the product can't back is a broken design, not a copy problem.

## 8. Known inconsistencies (decisions for Aashmiin, not bugs)

1. Deck uses Arial; site and product use Inter. (Portability vs brand. Recommend: keep Arial in .pptx,
   use Inter in PDF exports.) [ASSUMPTION]
2. Three "inks": `#0a0c11` site/paper, `#0b0e14` deck, `#111215` product dark. Harmless visually;
   unify only when a file is next touched.
3. Product accent `#3b5bdb` vs brand periwinkle `#8ea2ff`/`#6e7df0`. Intentional (light UI needs a
   darker blue for 4.5:1). Keep.
