# Design references: how the best product designers work, and what we take from them

Accessed 31 Oct 2026 (SGT). **Labels:** [VERIFIED] = I opened the primary source this run (the
standard, the company's own page/repo/package, the author's own book page). [ASSUMPTION: not opened,
<reason>] = I know of it but could not open it this run; treat as a pointer to check, never as a fact
to quote. A blog or summary about a source is `[ASSUMPTION: secondary, <site>]` even if opened.

**Network on 31 Oct:** reachable: `raw.githubusercontent.com`, `registry.npmjs.org` (via npm),
`developer.apple.com`. **Blocked** (DNS/proxy refused): `www.w3.org`, `stripe.com`, `linear.app`,
`refactoringui.com`, `m3.material.io`, `nngroup.com`, `designtokens.org`, `mercury.com`, `ramp.com`.
Ask Aashmiin to allow these hosts before upgrading any label below.

## 1. Frameworks and sources (primary first)

| Source | What we use it for | Label |
|---|---|---|
| **W3C WCAG 2.2** (normative text from the W3C's source repo `github.com/w3c/wcag`) | The accessibility gate: 1.4.3, 1.4.11, 1.4.1, 2.4.7, 2.4.11, 2.4.13, 2.5.8, 1.4.10, 2.3.3; contrast formula. Detail in `accessibility.md` | [VERIFIED: w3c/wcag source, 11 files]; w3.org page itself not opened (blocked) |
| **WAI-ARIA Authoring Practices Guide** (source repo `github.com/w3c/aria-practices`) | "Read me first": *a role is a promise*; ARIA "can both cloak and enhance". Button pattern (toggle = `aria-pressed` on a **button**, label must not change). Disclosure pattern (the FAQ `<details>` and any phone nav) | [VERIFIED: w3c/aria-practices source: read-me-first, button, disclosure, tabs] |
| **W3C Design Tokens Community Group format** (`github.com/design-tokens/community-group`, `technical-reports/format/`) | Token file shape: `$value`, `$type`, `$description`, groups, aliases `{group.token}`; names must not start with `$` or contain `{ } .`; `dimension` = `{value, unit: px|rem}`; `color` = `{colorSpace, components}`. Our `tokens.dtcg.json` follows it | [VERIFIED: community-group source: design-token.md, types.md, groups.md, README] |
| **Apple Human Interface Guidelines: Accessibility** (`developer.apple.com/design/human-interface-guidelines/accessibility`, read via its JSON data endpoint) | Minimum control size iOS **44×44 pt** (macOS 28×28); ~12 pt padding around bezelled elements, ~24 pt around bezel-less; WCAG AA contrast table (up to 17 pt: 4.5:1; 18 pt+ or bold: 3:1); Reduce Motion: cut automatic/repetitive animation, "replacing transitions in x-, y-, and z-axes with fades" | [VERIFIED: developer.apple.com, opened 31 Oct] |
| **Material Design 3** (m3.material.io) | Platform rules for Android: 48×48 dp touch targets, colour roles, tonal palettes | [ASSUMPTION: not opened, m3.material.io blocked]. Opened instead: `material-foundation/material-color-utilities` README [VERIFIED], which confirms M3 builds colour roles algorithmically and links "accessible contrast" guidance |
| **Refactoring UI**, Adam Wathan & Steve Schoger (book, 2018) | Working method: start with a feature not a layout; design in greyscale first; hierarchy by weight and colour, not only size; a constrained spacing and type scale defined up front; fewer borders, more spacing/background contrast; "don't use grey text on coloured backgrounds"; pick 8-10 shades per colour in advance | [ASSUMPTION: not opened this run, refactoringui.com blocked; recalled from the book: re-verify before quoting] |
| **Nielsen Norman Group: 10 usability heuristics** (Jakob Nielsen, 1994, updated 2020/2024) | Review lens for screens: visibility of status, match with the real world, user control, consistency, error prevention, recognition over recall, flexibility, minimalist design, error recovery, help | [ASSUMPTION: not opened, nngroup.com blocked] |
| **Stripe's published design writing** (e.g. "Designing accessible color systems", Daryl Koopersmith & Wilson Miner, stripe.com/blog, 2019) | Method: build the palette in a perceptually uniform space so each shade step gives a predictable contrast, and guarantee AA by construction rather than by checking afterwards | [ASSUMPTION: not opened, stripe.com blocked; title/authors from memory] |
| **Linear's published design writing** (linear.app/now, e.g. the 2024 UI redesign post; "Linear Method") | Method: theme generated from a few inputs (base, accent, contrast) in LCH; reduce visual noise; density for power users; keyboard-first; ship in small polished increments | [ASSUMPTION: not opened, linear.app blocked; from memory] |

## 2. Teardowns

### Teardown 1 (opened): GitHub's Primer design system, `@primer/primitives` 11.10.0
Link: https://github.com/primer/primitives (README) and the npm package `@primer/primitives@11.10.0`
(files `dist/css/functional/themes/{light,dark}.css`, `dist/css/functional/size/*.css`,
`src/tokens/functional/color/fgColor.json5`). [VERIFIED: opened 31 Oct via raw.githubusercontent.com and npm]

What it does:
- **Two token layers.** Base scales (`base.color.neutral.13`) and *functional* tokens named by job
  (`fgColor-default`, `fgColor-muted`, `bgColor-muted`, `borderColor-default`, `control-*`). Source is
  DTCG-style JSON5 (`$value: '{base.color.neutral.13}'`, `$type`, `$description`) with per-theme
  overrides in `$extensions` (light, dark, dark-dimmed, high-contrast, colour-blind variants).
- **Every text tier passes AA.** Computed with our script: `fgColor-default #1f2328` on white 15.80:1;
  `fgColor-muted #59636e` **6.11:1**; accent link `#0969da` 5.19:1; dark muted `#9198a1` on `#0d1117`
  6.50:1. Their *lowest* text tier is well above 4.5.
- **Targets by pointer type:** `--control-minTarget-coarse: 2.75rem` (44px) and `-fine: 1rem`,
  switched by `size-coarse.css`/`size-fine.css` (pointer media queries); control height 2rem (32px).
- Borders are decorative: `borderColor-default #d1d9e0` on white is only 1.43:1 (dark `#3d444d` 1.92:1).

**Copy:** semantic token names by job (we already half-do this; add `text-tertiary` meaning "still ≥
4.5:1"); a rule that the lowest text tier must pass AA (our `--text-3` doesn't, A1); coarse-pointer
target sizing (44px on touch, 32px controls on desktop); `$description` on every token saying where
it may be used.
**Don't copy:** nine themes (we are one founder: two themes is right); their low-contrast input
borders as proof that 1.4.11 is fine (popularity is not conformance; see A4); GitHub's grey-blue
palette or Primer components wholesale (it would make Clearline look like GitHub, i.e. templated).

### Teardown 2 (opened): Radix Colors 3.0.0 (WorkOS; Colm Tuite, Vlad Moroz)
Link: https://github.com/radix-ui/colors and npm `@radix-ui/colors@3.0.0` (`slate.css`,
`slate-dark.css`). [VERIFIED: opened 31 Oct]. Its docs site radix-ui.com was not opened, so the
"step N is for X" convention below is [ASSUMPTION: from memory of radix-ui.com/colors/docs].

What it does: every hue is a **12-step scale** in light and dark, with sRGB hex and a
`color(display-p3 …)` override inside `@supports`/`@media (color-gamut: p3)`. Steps 1-2 backgrounds,
6-8 borders, 11 low-contrast text, 12 high-contrast text [ASSUMPTION as above]. Computed: `slate-11
#60646c` on `slate-1 #fcfcfd` = **5.79:1**; dark `#b0b4ba` on `#111113` = **9.06:1**; border step 8
`#b9bbc6` on step 1 = 1.86:1.

**Copy:** design the *scale* first, then map roles onto steps, so "secondary text" can never be
chosen from a step that fails; ship P3 values for the periwinkle accent behind a gamut query (our
brand accent is exactly the kind of colour that looks better in P3).
**Don't copy:** adopting Radix's own hues (instant "every shadcn site" look); twelve steps per hue
for a product with one accent and three semantic colours (we need ~6 per hue).

### Teardown 3 (NOT opened this run): Stripe and Linear marketing sites and brand systems
Links to open when allowed: https://stripe.com/blog/accessible-color-systems, https://stripe.com,
https://linear.app/now (redesign post), https://linear.app/method, https://linear.app/brand.
Everything here is [ASSUMPTION: not opened, hosts blocked 31 Oct] and must not be quoted to anyone.
- **Copy (likely):** Stripe's real product UI in the hero instead of illustrations (we do this:
  real screenshots on fictional data, labelled); Linear's dark canvas, tight-tracked large type and a
  single restrained accent glow (our site already sits in this family; stay there); both companies
  publish their method, which is how we should treat the white paper.
- **Don't copy:** logo walls and customer-count headlines (we have 0 customers: company rule 2);
  Stripe's animated gradient mesh (performance and reduced-motion cost, and instantly recognisable as
  Stripe's); Linear's exact purple and noise texture (reads as a Linear clone, i.e. "templated").

### Teardown 4 (NOT opened): Mercury and Ramp marketing pages
https://mercury.com, https://ramp.com: [ASSUMPTION: not opened, blocked]. Pattern to verify later:
fintech pages lead with a concrete money claim and social proof. Our version: the concrete claim is
what the product does today, the proof is the demo film and the "52 of 52" own-test line with its
caveat (`Sections.tsx:66-71`), never logos or invented numbers.

## 3. How great product designers work (our synthesis; each point traceable above)

1. **System before screens:** tokens and scales decided once, then reused (Primer, Radix, DTCG,
   Refactoring UI [ASSUMPTION]).
2. **Accessibility by construction**, not audit: contrast is a property of the palette (Stripe
   [ASSUMPTION], Primer [VERIFIED]).
3. **Real content in mock-ups:** real product screenshots on fictional, labelled data; no lorem, no
   fake logos.
4. **Two sizes, every time:** desktop 1280 and phone 390, plus keyboard and reduced motion.
5. **Small, reviewable changes** through a PR with before/after screenshots and measured ratios.
6. **Restraint signals quality:** one accent, one type family, generous spacing, no stock 3D coins,
   no gradient soup, no emoji. This is what "doesn't look AI-generated" means in practice: specific
   content, our own tokens, deliberate rhythm, nothing default-looking (default Tailwind blue, default
   shadcn cards, centred-everything heroes with three identical feature cards).

## 4. Anti-patterns that make a page look templated or AI-generated (check list)
Generic gradient blobs unrelated to the product; three identical icon cards; "Trusted by" grey logo
strip; fake testimonial with a stock headshot; invented metrics ("10x faster", "$2B processed");
emoji in headings; every section centred; default Tailwind indigo `#6366f1`; default shadows on
everything; lorem or vague copy ("Revolutionize your workflow"); stock crypto imagery (coins, rockets,
neon). SPEC §9 already bans "gradients, neon, coin logos as decoration" in the product.
