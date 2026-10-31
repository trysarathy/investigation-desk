# Clearline working paper v0.3: what changed

Everything for this version is in `/whitepaper/v0.3/`. Your brief called it "v0.2", but PR #35 already uses
that name for the review-fixed version, so this one is **v0.3**. The v0.2 files in `/whitepaper/` are unchanged.

## Where your founder's note goes

Page 1, at the bottom, under the "What's built today / testing next / asking for" box. It is the dashed box
that reads **[FOUNDER'S NOTE: written by Aashmiin, 80–120 words]** (in `paper.html`, search for `FOUNDER'S NOTE`).
Replace the placeholder text with your note; the box will hold about 120 words at the current size.

## What changed

1. **Page 1 is now the executive summary**: the title and thesis, a hand-drawn picture of the gap, three short
   columns (the pain, what Clearline does, why now) and the "built / testing next / asking for" box. There is no
   status disclaimer. Page 1 is also printed on its own as `Clearline_Executive_Summary_v0.3.pdf`.
2. **The structure follows your brief**, sections 1–11. The problem section opens with a short scene, which is
   labelled as fictional. Then come the problem map, a table of what each failure costs (estimates labelled as
   estimates) and the US$50M case as a callout.
3. **Honesty is in one place.** The "Live today vs demo only" table, the known gaps and the roadmap are all in
   section 8. Elsewhere the paper describes what exists in the present tense. Live-mode limits are still stated
   where they matter: in live mode someone pastes the transaction ID, and payment pages work on Ethereum only.
4. **Real code in section 5.** There are five excerpts (rule order, the counterfeit check, the look-alike check,
   matching and scoring, and the posting plan with the plan key), each with its file path and line range. They are
   trimmed for reading only (`excerpts.mjs`). The JSON instruction and receipt schema is back, marked as a draft.
5. **Design.** The paper is built as HTML and printed with Chromium: Newsreader headings, Inter body text,
   JetBrains Mono code, and the website's indigo accent. All fonts are bundled in `fonts/` under the OFL licence.
   There are four mind maps plus redrawn architecture and sequence diagrams, all hand-drawn with rough.js. Each
   has an SVG in `figures/` and an editable `.excalidraw` file in `excalidraw/`.

Every correction from the v0.2 review is kept, including:
- the "about 1%" market maths with the right attribution;
- the Polygon/BNB wrong-network example and recoverability;
- the ÚЅDТ wording;
- the checker only warns;
- the append-only scope;
- the Xero permissions (fixed in PR #36);
- the test counts;
- AI explanations sent to Anthropic when enabled;
- the Request Finance, HitPay and Stripe limits;
- sanctions, accounting classification, finality and liability.

## Files

| File | What it is |
|---|---|
| `paper.html`, `style.css` | The source. Edit the text here |
| `excerpts.mjs` | The code excerpts, with file paths and line ranges |
| `diagrams.mjs`, `figures.mjs` | The figures as data, and the code that draws them |
| `figures/*.svg`, `excalidraw/*.excalidraw` | The figures, as SVG and as editable Excalidraw files |
| `build.mjs` | `npm install && node build.mjs` draws the figures and prints the PDFs |
| `Clearline_Whitepaper_v0.3.pdf` | The clean copy |
| `Clearline_Whitepaper_v0.3_review.pdf` | Every claim labelled VERIFIED, ASSUMPTION or GUESS |
| `Clearline_Executive_Summary_v0.3.pdf` | Page 1 on its own |
