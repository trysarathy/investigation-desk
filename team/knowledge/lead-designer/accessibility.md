# Accessibility: the rules, how we measure, and what we found (31 Oct 2026)

Standard: **WCAG 2.2 Level AA** for everything Clearline ships (SPEC §9 already says "WCAG 2.2 AA
target"). Platform guidance (Apple HIG, Material) is used where WCAG is silent, labelled as such.

**Source note.** w3.org was **blocked** from this session (DNS refused, 31 Oct). The normative text
below was read from the W3C's own source repository for WCAG, `github.com/w3c/wcag` (main branch,
files under `guidelines/sc/`, `guidelines/terms/`, `understanding/`), which is what w3.org/TR/WCAG22
is built from. Labelled `[VERIFIED: w3c/wcag source]`. Re-check against https://www.w3.org/TR/WCAG22/
when w3.org is allowed (ask Aashmiin to allow `www.w3.org` in the session's network settings).

## 1. The rules we check on every deliverable

| # | Rule (WCAG 2.2 SC, level) | Requirement in one line | Source |
|---|---|---|---|
| R1 | 1.4.3 Contrast (Minimum), AA | Text ≥ **4.5:1**; large text ≥ **3:1**. Large = ≥ 18pt (24 CSS px) or ≥ 14pt bold (18.66 px bold). Exempt: inactive controls, pure decoration, logotypes | [VERIFIED: w3c/wcag source] `guidelines/sc/20/contrast-minimum.html`, `terms/20/large-scale.html` |
| R2 | 1.4.11 Non-text Contrast, AA | Visual information needed to identify a UI component and its states, and graphics needed to understand content, ≥ **3:1** against adjacent colours. A control with visible text needs no boundary; a control with no other visual cue (an empty text field) does. Focus indicators must reach 3:1 too. Thresholds are not rounded (2.999 fails) | [VERIFIED: w3c/wcag source] `sc/21/non-text-contrast.html`, `understanding/21/non-text-contrast.html` |
| R3 | 1.4.1 Use of Color, A | Colour is never the only way to convey information or distinguish a link | [VERIFIED: w3c/wcag source] `sc/20/use-of-color.html` |
| R4 | 2.4.7 Focus Visible, AA | Every keyboard-operable control shows a visible focus indicator | [VERIFIED: w3c/wcag source] `sc/20/focus-visible.html` |
| R5 | 2.4.11 Focus Not Obscured (Minimum), AA (new in 2.2) | A focused control is never **entirely** hidden by author content (sticky headers, cookie bars) | [VERIFIED: w3c/wcag source] `sc/22/focus-not-obscured-minimum.html` |
| R6 | 2.4.13 Focus Appearance, **AAA** (new in 2.2) | Indicator area ≥ a 2 CSS px perimeter and 3:1 between focused/unfocused pixels. AAA: we aim for it (our 2px outlines meet it) but it is not a gate | [VERIFIED: w3c/wcag source] `sc/22/focus-appearance.html` |
| R7 | 2.5.8 Target Size (Minimum), AA (new in 2.2) | Pointer targets ≥ **24 × 24 CSS px**, unless: spacing (24px circles don't overlap), equivalent control, inline in a sentence, user-agent control unmodified, essential | [VERIFIED: w3c/wcag source] `sc/22/target-size-minimum.html`, `understanding/22/target-size-minimum.html` |
| R8 | 1.4.10 Reflow, AA | No two-dimensional scrolling at **320 CSS px** width (= 1280px at 400% zoom); data tables may scroll on their own | [VERIFIED: w3c/wcag source] `sc/21/reflow.html` |
| R9 | 2.3.3 Animation from Interactions, **AAA** + 2.2.2 Pause, Stop, Hide (A) | Motion triggered by interaction can be turned off; we honour `prefers-reduced-motion` everywhere (house rule, stricter than AA) | [VERIFIED: w3c/wcag source] `sc/21/animation-from-interactions.html`; 2.2.2 [ASSUMPTION: not reopened this run] |
| R10 | 4.1.2 Name, Role, Value, A | Valid roles/states; native HTML first ("a role is a promise"; "no ARIA is better than bad ARIA") | APG "Read me first" [VERIFIED: w3c/aria-practices source]; SC text [ASSUMPTION: not reopened] |

**House rules (stricter than AA, ours, 31 Oct):** phone check at **390 px** (and spot check at 320 px
for R8); touch targets on phone aim for **44 × 44 pt** (Apple HIG minimum control size for iOS:
"44x44 pt", [VERIFIED: developer.apple.com HIG Accessibility JSON, opened 31 Oct]) while 24 px stays the
AA gate; every animation stops under reduced motion; status = text + icon + colour.

**Contrast formula** [VERIFIED: w3c/wcag source `terms/20/relative-luminance.html`,
`terms/20/contrast-ratio.html`]: ratio = (L1 + 0.05) / (L2 + 0.05); L = 0.2126 R + 0.7152 G + 0.0722 B
with each channel linearised (c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4). The old 0.03928
threshold "has no practical effect". Measure against "the specified background over which the text is
rendered in normal usage"; composite any alpha over that background first.

## 2. How to measure (tools in this pack; no paid tools)

1. **Token pairs:** `node team/knowledge/lead-designer/tools/contrast.mjs` prints the table below from
   the hex values in the code. One pair: `node …/contrast.mjs '#8a8d94' '#ffffff'` → `3.32:1`.
2. **Fix suggestions:** `node …/tools/suggest.mjs <fg> 4.5 <bg> [bg…]` finds the smallest same-hue
   change that passes on every listed background.
3. **Rendered pages:** `AXE=<path>/axe.min.js NODE_PATH=$(npm root -g) node …/tools/screen-audit.cjs
   <baseUrl> <outDir> /path …` → full-page screenshots at 1280×800 and 390×844, horizontal-overflow
   check, contrast of every rendered text node vs its real background, targets < 24 px with the
   spacing/inline exceptions, focus outline on the first 15 Tab stops, reduced-motion check, and
   axe-core 4.10.2 (WCAG A/AA rules; install with `npm i axe-core@4.10.2` in a scratch dir).
   axe is a second opinion: it finds ~a subset of issues; it never replaces the manual checks.
4. **Manual, every time:** keyboard-only pass (Tab, Shift+Tab, Enter, Space, Esc) through every
   interactive part, including custom controls the 15-stop script doesn't reach; zoom 200%; 320px;
   check every gradient/image background by eye (scripts can't see through `background-image`).

## 3. Computed contrast for every real token pair (generated 31 Oct 2026 by `tools/contrast.mjs`)

"FAIL (large text only)" = passes 3:1, so legal only at ≥ 24px or ≥ 18.66px bold. Border/divider
rows marked "decorative" are exempt when the element is also identified another way (R2).

| Surface | Foreground | Background | Ratio | Needs | Result | Used for |
|---|---|---|---|---|---|---|
| website | fg `#eceef4` | ink `#0a0c11` | 16.86:1 | text (4.5:1) | PASS | body text |
| website | muted `#a3abba` | ink `#0a0c11` | 8.47:1 | text (4.5:1) | PASS | sublines, section body |
| website | muted `#a3abba` | panel `#11141b` | 7.98:1 | text (4.5:1) | PASS | card body (bg-panel) |
| website | faint `#8a93a3` | ink `#0a0c11` | 6.32:1 | text (4.5:1) | PASS | 13-13.5px footnotes, footer legal |
| website | faint `#8a93a3` | panel `#11141b` | 5.95:1 | text (4.5:1) | PASS | browser-frame label 12px |
| website | faint `#8a93a3` | panel2 `#161a23` | 5.62:1 | text (4.5:1) | PASS | worst-case panel-2 |
| website | accent `#8ea2ff` | ink `#0a0c11` | 8.16:1 | text (4.5:1) | PASS | eyebrows, links |
| website | ink on fg `#0a0c11` | fg `#eceef4` | 16.86:1 | text (4.5:1) | PASS | primary button label |
| website | good `#5fd3a0` | ink `#0a0c11` | 10.54:1 | text (4.5:1) | PASS | status dot / good text |
| website | warn `#f5b85c` | ink `#0a0c11` | 11.08:1 | text (4.5:1) | PASS | warning text |
| website | bad `#f28b82` | ink `#0a0c11` | 8.19:1 | text (4.5:1) | PASS | error text |
| website | accent (focus ring) `#8ea2ff` | ink `#0a0c11` | 8.16:1 | ui (3:1) | PASS | 2px :focus-visible outline |
| website | line-strong (14% white) `#2c2e32` | ink `#0a0c11` | 1.44:1 | ui (3:1) | FAIL | secondary-button border, form-field border |
| website | line (8% white) `#1e1f24` | ink `#0a0c11` | 1.19:1 | ui (3:1) | FAIL | dividers (decorative, exempt) |
| website | accent-strong `#6e7df0` | ink `#0a0c11` | 5.45:1 | text (4.5:1) | PASS | if ever used as text |
| product light | text `#17181c` | canvas `#f7f7f5` | 16.54:1 | text (4.5:1) | PASS | body |
| product light | text-2 `#5b5e66` | panel `#ffffff` | 6.49:1 | text (4.5:1) | PASS | .muted |
| product light | text-2 `#5b5e66` | canvas `#f7f7f5` | 6.05:1 | text (4.5:1) | PASS | .muted on canvas |
| product light | text-3 `#8a8d94` | panel `#ffffff` | 3.32:1 | text (4.5:1) | FAIL (large text only) | .faint, table headers 12px, .k labels, hints |
| product light | text-3 `#8a8d94` | canvas `#f7f7f5` | 3.10:1 | text (4.5:1) | FAIL (large text only) | .faint on canvas, .pay-foot |
| product light | text-3 `#8a8d94` | panel-2 `#fafaf9` | 3.18:1 | text (4.5:1) | FAIL (large text only) | .faint on panel-2 |
| product light | accent `#3b5bdb` | panel `#ffffff` | 5.67:1 | text (4.5:1) | PASS | links |
| product light | accent `#3b5bdb` | canvas `#f7f7f5` | 5.28:1 | text (4.5:1) | PASS | links on canvas |
| product light | accent-text `#ffffff` | accent `#3b5bdb` | 5.67:1 | text (4.5:1) | PASS | primary button |
| product light | accent `#3b5bdb` | accent-soft `#edf1fd` | 5.02:1 | text (4.5:1) | PASS | pill confirming / tone-progress |
| product light | green `#1f7a3d` | green-soft `#e9f5ec` | 4.79:1 | text (4.5:1) | PASS | pill completed / tone-paid |
| product light | green `#1f7a3d` | panel `#ffffff` | 5.37:1 | text (4.5:1) | PASS | pill matched, s-pass |
| product light | amber `#8a5a00` | amber-soft `#fdf3dc` | 5.37:1 | text (4.5:1) | PASS | bar-amber, needs review |
| product light | red `#b42318` | red-soft `#fdecea` | 5.75:1 | text (4.5:1) | PASS | bar-red, blocked |
| product light | text-2 `#5b5e66` | panel-2 `#fafaf9` | 6.21:1 | text (4.5:1) | PASS | badge, awaiting pill |
| product light | border-strong `#d2d2cc` | panel `#ffffff` | 1.52:1 | ui (3:1) | FAIL | .btn / .input border |
| product light | border `#e4e4e0` | panel `#ffffff` | 1.27:1 | ui (3:1) | FAIL | panel border (decorative) |
| product light | focus `#3b5bdb` | panel `#ffffff` | 5.67:1 | ui (3:1) | PASS | focus ring |
| product light | focus `#3b5bdb` | canvas `#f7f7f5` | 5.28:1 | ui (3:1) | PASS | focus ring on canvas |
| product dark | text `#ececee` | canvas `#111215` | 15.88:1 | text (4.5:1) | PASS | body |
| product dark | text-2 `#a4a7ae` | panel `#18191d` | 7.29:1 | text (4.5:1) | PASS | .muted |
| product dark | text-3 `#767982` | panel `#18191d` | 4.04:1 | text (4.5:1) | FAIL (large text only) | .faint, table headers |
| product dark | text-3 `#767982` | canvas `#111215` | 4.31:1 | text (4.5:1) | FAIL (large text only) | .faint on canvas |
| product dark | accent `#6b86f0` | panel `#18191d` | 5.26:1 | text (4.5:1) | PASS | links |
| product dark | accent-text `#0d1020` | accent `#6b86f0` | 5.66:1 | text (4.5:1) | PASS | primary button |
| product dark | accent `#6b86f0` | accent-soft `#1e2440` | 4.56:1 | text (4.5:1) | PASS | pill confirming |
| product dark | green `#5cc98a` | green-soft `#15291e` | 7.44:1 | text (4.5:1) | PASS | pill completed |
| product dark | amber `#e8b45a` | amber-soft `#2e2512` | 7.99:1 | text (4.5:1) | PASS | bar-amber |
| product dark | red `#f1877d` | red-soft `#351a18` | 6.48:1 | text (4.5:1) | PASS | bar-red |
| product dark | border-strong `#383a41` | panel `#18191d` | 1.55:1 | ui (3:1) | FAIL | .btn / .input border |
| product dark | focus `#8aa0f5` | panel `#18191d` | 7.05:1 | ui (3:1) | PASS | focus ring |
| deck | WHITE `#f2f4f7` | INK `#0b0e14` | 17.53:1 | text (4.5:1) | PASS | titles, body |
| deck | MUTED `#a3aab6` | INK `#0b0e14` | 8.26:1 | text (4.5:1) | PASS | subtitles 20pt |
| deck | MUTED `#a3aab6` | CARD `#151a24` | 7.45:1 | text (4.5:1) | PASS | card body |
| deck | FAINT `#767e8c` | INK `#0b0e14` | 4.72:1 | text (4.5:1) | PASS | 10pt source footers |
| deck | FAINT `#767e8c` | CARD `#151a24` | 4.26:1 | text (4.5:1) | FAIL (large text only) | faint on card |
| deck | ACC `#8ea2ff` | INK `#0b0e14` | 8.06:1 | text (4.5:1) | PASS | pills, accents |
| deck | ACC2 `#b9c6ff` | INK `#0b0e14` | 11.58:1 | text (4.5:1) | PASS | tagline, label tags |
| deck | RED `#ff8a7f` | INK `#0b0e14` | 8.46:1 | text (4.5:1) | PASS | warnings |
| deck | LINE `#2a3140` | CARD `#151a24` | 1.34:1 | ui (3:1) | FAIL | card border (decorative) |
| whitepaper | ink `#0a0c11` | paper `#ffffff` | 19.56:1 | text (4.5:1) | PASS | body |
| whitepaper | muted `#5b6272` | paper `#ffffff` | 6.11:1 | text (4.5:1) | PASS | captions, footnotes, footer |
| whitepaper | accent `#6e7df0` | paper `#ffffff` | 3.59:1 | text (4.5:1) | FAIL (large text only) | links, section rule |
| whitepaper | ink `#0a0c11` | accentbg `#f4f5ff` | 18.03:1 | text (4.5:1) | PASS | statusbox text |
| whitepaper | vgreen `#2f7d5b` | paper `#ffffff` | 4.99:1 | text (4.5:1) | PASS | [VERIFIED] tag (scriptsize) |
| whitepaper | aamber `#a8670f` | paper `#ffffff` | 4.55:1 | text (4.5:1) | PASS | [ASSUMPTION] tag (scriptsize) |
| whitepaper | gred `#b23a30` | paper `#ffffff` | 5.93:1 | text (4.5:1) | PASS | [GUESS] tag (scriptsize) |
| whitepaper | rule `#c9cdd6` | paper `#ffffff` | 1.59:1 | ui (3:1) | FAIL | table rules (decorative) |

## 4. Live audit, 31 Oct 2026 (evidence)

**Setup.** Website: `origin/pitch-deck` @ `ad15acb`, `website/` built with `next build` (static
export), served locally, pages `/`, `/demo/`, `/privacy/`. Product: `origin/main` @ `8decb27`,
`next build` + `next start` with `DEMO_MODE=on AI_EXPLANATIONS=off`, "Load the demo day" clicked,
pages `/requests` (At a glance), `/requests/DEMO-1043` (counterfeit USDT case), `/requests/all`.
Both in scratch worktrees, removed afterwards. Screenshots: `screens/website/*.png`,
`screens/product/*.png`; raw results: `screens/*/audit.json`.

| Page @ viewport | Horizontal scroll | Rendered text pairs / failing | axe-core violations | Focus visible (first 15 stops) |
|---|---|---|---|---|
| Website `/` @ 1280 | none (1280/1280) | 40 / 0 (lowest 5.95:1) | none | 15/15 |
| Website `/` @ 390 | none (390/390) | 40 / 0 | none | 15/15 |
| Website `/demo/` @ 1280 · 390 | none · none | 11 / 0 · 11 / 0 | none · none | 15/15 · 14/14 |
| Website `/privacy/` @ 1280 · 390 | none · none | 11 / 0 · 11 / 0 | none · none | 15/15 · 14/14 |
| Product `/requests` @ 1280 · 390 | none · none | 33 / 7 · 33 / 7 | color-contrast ×18 · ×19 | 15/15 · 15/15 |
| Product `/requests/DEMO-1043` @ 1280 · 390 | none · none | 38 / 9 · 38 / 9 | color-contrast ×23 · ×25; link-in-text-block ×1 | 15/15 · 15/15 |
| Product `/requests/all` @ 1280 · 390 | none · none | 21 / 4 · 21 / 4 | color-contrast ×68 · ×25; **aria-allowed-attr ×5 (critical)** | 15/15 · 15/15 |

Method note: this run used `screen-audit.cjs` before ancestor-`opacity` handling was added (same day, after a fixture test showed a 50%-opacity logo strip slipping through). axe-core, which does account for opacity, independently found 0 contrast violations on the website, so the website result stands; the product failures are on fully opaque text.

Reduced motion: with `prefers-reduced-motion: reduce`, **0** running animations and
`scroll-behavior: auto` on both the website home and the product (`document.getAnimations()`).
Hero gradient text (skipped by the script): darkest stop `#7f92ff` on ink = 6.95:1, and 4.49:1 at
the brightest point of the glow (`#2a3058` composite); it is 38-68px, so large text: passes 3:1.

### Findings (open issues; each becomes a PR, never a push to main)

| ID | Severity | Where | Finding | Evidence | Fix (proposed) |
|---|---|---|---|---|---|
| **A1** | **High (AA fail, everywhere in the product)** | Product `--text-3` (`origin/main:src/app/globals.css:9`, dark :35) | `#8a8d94` is **3.32:1** on white, **3.10:1** on canvas, **3.18:1** on panel-2; dark `#767982` **4.04:1** on panel, 4.31:1 on canvas. Used for 11-13px text: table headers, `.eyebrow`, `.faint` invoice refs, KPI labels, timestamps, `.mode-note`, `.pay-foot`, placeholders (`.input::placeholder`, :148) | Rendered: "INV-1043" 13px 3.32:1 ×62 on `/requests/all`; "Today 12:18 SGT" 12px ×22; axe color-contrast up to 68 nodes | Light `--text-3: #6e7176` (4.57:1 worst case on canvas); dark `--text-3: #82858d` (4.51:1 worst on panel-2). Keeps three text tiers (text-2 6.49 / text-3 4.6). One-line token change + visual check of every page |
| **A2** | Medium (critical in axe, 4.1.2) | `origin/main:src/app/requests/all/page.tsx:36` + `globals.css:156` | Filter chips are links with `aria-pressed`: `aria-pressed` is not allowed on `<a>`; screen readers may announce nonsense or ignore the state | axe aria-allowed-attr ×5 at both viewports | Use `aria-current="page"` on the active link and restyle `.chip[aria-current="page"]` (CSS selector change in the same PR) |
| **A3** | Medium (2.4.7 AA fail) | Website design-partner form radio chips, `origin/pitch-deck:website/src/components/Partners.tsx:92-95` | Radio input is `sr-only` (1×1 px) and the label has no focus style, so keyboard focus on "Checkout page / Direct transfer / Both / Not sure" is **invisible** | `screens/website/form-radio-focus-phone-390.png` (taken with focus on "Checkout page"); focused element measured 1×1 px, label outline none | Add `has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2` to the label |
| **A4** | Medium (1.4.11 AA, judgement) | Website form fields `Partners.tsx:13` (field `bg-ink` + `border-line-strong` on a `bg-panel` card) and product `.input` (`globals.css:144`: white on white, `#d2d2cc` border) | Empty text fields are identified only by their boundary: website border ≈1.4:1, field fill vs card 1.06:1; product border **1.52:1** (dark 1.55:1). Understanding 1.4.11: a boundary is required "when there is no other visual way to identify the presence of the control" | Computed from tokens (table above) | Website: field border `rgb(255 255 255 / 0.28)` or fill `bg-panel-2` + lighter border, re-measure to ≥ 3:1. Product: input border `#8f8f8b` light (3.03:1) / `#64656b` dark (3.02:1) **for inputs only**; keep `--border-strong` for buttons (their text identifies them) |
| **A5** | Low (1.4.1 A) | Product request page: a link to Books inside `.faint` text (axe target `.faint > a[href$="books"]`; source line not yet located) | Link distinguished by colour only inside a text block | axe link-in-text-block ×1 | Underline links inside running text (`text-decoration: underline; text-underline-offset: 2px`), as `.linkish` already does |
| **A6** | Low (print/PDF; AA if the PDF is published) | White paper links `style.tex` / `build.py:87` `linkcolor=accent` `#6e7df0` | **3.59:1** on white: fails 4.5:1 for 10pt link text | Table above | Link colour `#606dd1` (4.56:1) or the product blue `#3b5bdb` (5.67:1); keep `#6e7df0` for the rule and title bar (graphics, 3:1 ok) |
| **A7** | Low | Deck `FAINT #767e8c` on `CARD #151a24` | **4.26:1** (passes on ink at 4.72:1) | Table above | Use `MUTED` inside cards, or FAINT `#7b8391` (4.56:1) |
| A8 | Advisory | Website phone header (`ui.tsx:128`) | Nav is hidden below 768px with no menu; phone users reach sections only by scrolling. Not a WCAG fail (same content reachable) | `screens/website/home-phone-390.png` | Consider a disclosure nav (APG Disclosure Navigation Menu pattern) |
| A9 | Advisory | Website footer and header nav links 17-21px tall | Pass 2.5.8 by the spacing exception; below the 44pt phone house target | audit.json smallTargets | Raise to `py-2` on phone when the footer is next touched |
| A10 | Advisory | Product phone header (`screens/product/requests-DEMO-1043-phone-390.png`) | Workspace, nav chips, demo note and Theme select stack into a crowded 4-row header at 390px | Screenshot | Collapse Theme into a menu on phone; candidate for a playbook §1 review |

What passed and why it matters: the website meets every measured AA check at both widths, including
all 15 sampled focus stops (2px `#8ea2ff` outline, 8.16:1) and full reduced-motion support; the
product's semantic pills all pass in both themes (lowest: dark accent on accent-soft 4.56:1); no page
scrolls sideways at 390px; the product's tables switch to cards below 760px.

What I could not check this run: VoiceOver/NVDA screen-reader output (none in the container); 200%
zoom and 320px (R8) on every page (only 390px run); the deck and white paper as rendered files (only
their token pairs); the website `/` form beyond the radio, select and textarea; `/pay/[publicId]`
and Xero/Books pages in the product.

Sources opened for this file (31 Oct 2026): raw.githubusercontent.com/w3c/wcag/main/… (11 files listed
above); raw.githubusercontent.com/w3c/aria-practices/main/content/practices/read-me-first/read-me-first-practice.html,
…/patterns/button/button-pattern.html, …/patterns/disclosure/disclosure-pattern.html;
developer.apple.com/tutorials/data/design/human-interface-guidelines/accessibility.json; axe-core 4.10.2 (npm).
