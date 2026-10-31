# Knowledge pack: lead-designer

Reference material for Clearline's lead designer (product UI, website, decks, white-paper layouts,
diagrams, brand system). Last refreshed **31 Oct 2026** against `origin/pitch-deck` @ `ad15acb`
(website, deck), `origin/main` @ `8decb27` (product UI), `origin/whitepaper` @ `827a0ec`.
Refresh owner: **lead-designer** (every Thursday review, and in the same PR whenever a cited file
changes); monthly re-check by research-intern's knowledge refresh. Labels: [VERIFIED] primary source
opened or command run while writing; [ASSUMPTION] / [ASSUMPTION: secondary, <source>] / [GUESS].

| File | Use it for | Refresh when |
|---|---|---|
| `brand-system.md` | The real tokens (colour hex, type scale, spacing, radii, components, logo) for website, product, deck and paper, with file:line cites | Any change to a `globals.css`, `ui.tsx`, `deck_style.py`, `style.tex`, logo |
| `tokens.dtcg.json` | The same tokens in W3C DTCG format for tools | Same as above (regenerate) |
| `accessibility.md` | WCAG 2.2 AA rules we gate on, how to measure, every token pair's computed contrast, the 31 Oct live audit and open issues A1-A10 | Every audit; any token change; when w3.org is reachable (upgrade source note) |
| `design-references.md` | Frameworks and sources (primary vs not opened), teardowns (Primer, Radix opened; Stripe, Linear, Mercury, Ramp not opened), anti-template list | Monthly, or when a blocked host is allowed |
| `deck-and-paper-layouts.md` | How decks, the white paper and diagrams are built and the layout rules | Change to `pitch/src/*`, `whitepaper/build.py`/`style.tex`, `diagrams/` |
| `review-checklist.md` | The gate + craft checklist every deliverable must pass | When a rule or tool changes |
| `tools/contrast.mjs` | WCAG contrast for all token pairs (table) or one pair | When tokens change (update the pairs) |
| `tools/suggest.mjs` | Smallest same-hue fix that reaches a target ratio | — |
| `tools/screen-audit.cjs` | Playwright: 1280 + 390 screenshots, overflow, rendered contrast, targets, focus, reduced motion, optional axe-core | — |
| `screens/website/`, `screens/product/` | 31 Oct audit screenshots + `audit.json` (evidence for accessibility.md §4) | Replace on each audit (keep the date in the note) |

Our decisions recorded here (31 Oct 2026):
- WCAG 2.2 **AA** is the gate; 2.4.13 Focus Appearance (AAA) and reduced motion everywhere are house
  targets. Phone check width 390px; touch target house goal 44px.
- Two looks on purpose: dark brand (website, deck) and calm instrument (product, paper). No blending.
- No paid design tools: Playwright (preinstalled), axe-core (MIT, npm) and our scripts. Figma is not
  required; if Aashmiin wants Figma files later, that's her call and cost.
- Website audit runs on a static export in a scratch worktree, never the shared worktree.

Network note (31 Oct): `www.w3.org`, `stripe.com`, `linear.app`, `refactoringui.com`, `m3.material.io`,
`nngroup.com`, `designtokens.org`, `mercury.com`, `ramp.com` were blocked; WCAG, ARIA APG and DTCG
were read from their official source repos on GitHub instead. Allowing those hosts lets the next
refresh upgrade the [ASSUMPTION: not opened] labels.
