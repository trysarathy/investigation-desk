# Design review checklist (every screen, page, slide, paper layout, diagram)

A deliverable "meets the checklist" only when every **Gate** line is ticked with evidence (a ratio, a
screenshot path, a command output). **Craft** lines are scored; two or more misses = "not yet". Paste
the filled checklist into the PR body or the review note.

## A. Honesty gates (any miss = stop; company rule 2)
- [ ] **G1** No logos of other companies (no "trusted by", "as seen in", partner or investor strips)
      unless written permission exists and Aashmiin approved that exact use.
- [ ] **G2** No testimonials, quotes, names, headshots or case studies that aren't real and approved.
      Illustrative quotes say "illustrative" next to them.
- [ ] **G3** No invented numbers (customers, volume, time saved, accuracy). Every number on the
      artefact traces to code, a test, or a cited source, and carries its label/marker.
- [ ] **G4** Demo data is labelled "demo data" / "fictional" wherever product screens appear.
- [ ] **G5** Claims match the product today ("once you approve", "Xero first, QuickBooks next"; never
      "posts automatically", "live with customers").

## B. Accessibility gates (WCAG 2.2 AA; how to measure: accessibility.md §2)
- [ ] **G6** Text contrast ≥ 4.5:1 (large ≥ 3:1), computed with `tools/contrast.mjs` from the actual
      hex values, both themes where the surface has two. Gradients/images checked by eye at the worst point.
- [ ] **G7** UI component boundaries/states and meaningful graphics ≥ 3:1 (empty inputs, checkboxes,
      chart lines, focus rings).
- [ ] **G8** Visible focus on every interactive element, including custom radios/checkboxes and
      anything `sr-only`; focused element never fully hidden by a sticky header (2.4.11).
- [ ] **G9** Targets ≥ 24×24 CSS px or meet the spacing/inline exception; phone house target 44px for
      primary actions.
- [ ] **G10** Colour is never the only signal (status = text + icon/dot + colour; links in text underlined).
- [ ] **G11** `prefers-reduced-motion: reduce` stops every animation (`document.getAnimations()` = 0
      running) and smooth scroll.
- [ ] **G12** Phone 390px: no horizontal page scroll (`scrollWidth == clientWidth`); tables scroll
      inside their own wrapper or become cards. Spot check 320px.
- [ ] **G13** Semantics: one `h1`, ordered headings, labelled form fields, alt text that states the
      takeaway (decorative images `alt=""`/`aria-hidden`), valid ARIA only (axe: 0 critical/serious).

## C. Brand gates (match the existing system; brand-system.md)
- [ ] **G14** Only tokens from brand-system.md (no new hex without a PR that adds it to the system).
- [ ] **G15** The right mode: website/deck = dark brand; product/paper = calm light/dark instrument.
- [ ] **G16** Inter (deck: Arial), existing type scale, existing radii, existing components reused.

## D. Process gates
- [ ] **G17** Screenshots at 1280 and 390 attached (`screen-audit.cjs` output), before and after.
- [ ] **G18** Change is on a branch with a PR; nothing pushed to `main`; nothing published or sent
      outside without Aashmiin's approval.
- [ ] **G19** PAUSE was checked at the start of the run.

## E. Craft (score 1-5 each; target ≥ 4)
- [ ] Hierarchy: the one thing to read first is obvious in a 3-second squint test (greyscale screenshot).
- [ ] Rhythm: spacing from the scale (4/8px multiples), aligned edges, consistent section padding.
- [ ] Density fits the surface: marketing breathes, product is dense but scannable (tabular numbers,
      middle-truncated hashes).
- [ ] Copy: sentence case, short, no blame, no exclamation marks, no jargon without a gloss
      ("stablecoins (digital dollars)").
- [ ] Nothing looks default or templated (design-references.md §4 anti-pattern list).
- [ ] States designed: empty, loading (no full-page spinner), error, long values, 0 and 1 items,
      very long company names.
- [ ] Nielsen heuristics pass: status visible, error prevention (e.g. "Mark paid · blocked" with the
      reason), recognition over recall, user control (undo/close).

## F. Surface extras
- **Deck:** one idea per slide; headline is a sentence; ≥ 18pt body, ≥ 10pt sources; marker key in
  the footer; speaker notes carry the sources; contact sheet viewed.
- **White paper:** links ≥ 4.5:1; captions state the takeaway; review copy built and the tags read.
- **Diagram/mind map:** real mechanism; ≤ 7 branches; meaningful lines ≥ 3:1; red also dashed/labelled;
  SVG `<title>` + alt.
- **Website:** one primary CTA per view; OG image updated if the headline changed; Lighthouse mobile
  performance not lower than before [ASSUMPTION: needs a Lighthouse run; not in this pack yet].
