# Playbooks: lead-designer

Every playbook starts with **step 0**: read Settings `PAUSE` (and the Gmail PAUSE search, company rule
1). If PAUSE = TRUE: write one Log row ("lead-designer: stopped, PAUSE on") and stop.
Paths: `K = team/knowledge/lead-designer`. Scratch = the session scratchpad, never the shared worktree.
Every playbook ends with a Log row: `<SGT timestamp> | lead-designer | <action> | <ids> | <details + links>`.

---

## Fixes from qualification (31 Oct)
- **Labels:** a fact taken from slide notes, a report, the founder's notes or your own pack keeps its
  original label with who/date (company rule 2); never `[VERIFIED <file>]` or a bare `[VERIFIED]` on a
  number you didn't measure this run. Ratios you computed this run: `[VERIFIED: measured <date>, <script>]`.
- **A token change is checked on every surface it touches** (light, dark, tinted boxes, cards, the
  website and the product), with the ratio for each, before you say it "fixes" anything.
- **Keep full caveats with any statistic** in a design (e.g. "52 of 52 in our own test; matching not yet
  tested on real data"). Headlines never claim more than the evidence ("The checks work" is too strong).
- **Diff hygiene:** correct paths, no build artefacts (`.pyc`, `out/`); PRs go into the feature branch
  the task names, never into `main` by default.

## §1 Screen review (desktop 1280 + phone 390)
**Trigger:** a PR or branch touching UI (`src/app`, `src/components`, `globals.css`, `website/src`),
a request "review this screen", or §8.
**Inputs:** branch/commit, the pages that changed (from the diff), the claim/purpose of the screen.
**Steps:**
1. Scratch copy at the exact commit: `git worktree add --detach <scratch>/wt <sha>` (or
   `git archive <sha> website | tar -x -C <scratch>`). `npm ci`.
2. Serve it. Website: `cd website && npx next build` then serve `out/` (`python3 -m http.server 3400
   --bind 127.0.0.1` from `out/`). Product: `npx next build && DEMO_MODE=on AI_EXPLANATIONS=off
   DESK_DATA_DIR=<scratch>/desk npx next start -p 3300`, then click "Load the demo day" once.
3. Run the audit on the changed pages and one neighbour:
   `AXE=<scratch>/tools/node_modules/axe-core/axe.min.js NODE_PATH=$(npm root -g) node K/tools/screen-audit.cjs http://127.0.0.1:<port> <scratch>/shots /path …`
   (install axe once: `npm i axe-core@4.10.2` in `<scratch>/tools`).
4. Look at every screenshot yourself (Read the PNG): hierarchy, alignment, crowding at 390, cut-off
   text, demo labels present. Crop tall pages to read them.
5. Manual: Tab through every interactive element on the changed part (the script only samples 15
   stops; custom radios, menus and dialogs need a person), check Esc/Enter/Space, zoom 200%, 320px.
6. For any new colour pair: `node K/tools/contrast.mjs '<fg>' '<bg>'`; for a fail,
   `node K/tools/suggest.mjs '<fg>' 4.5 '<bg>' …`.
7. Fill `K/review-checklist.md`. Write findings: ID, severity (High = AA fail on a main path or a
   Gate A breach; Medium = AA fail elsewhere; Low; Advisory), where (file:line), evidence (ratio,
   screenshot path), fix.
8. Stop the servers (kill by PID, not `pkill -f` with a pattern that matches your own shell) and
   `git worktree remove --force <scratch>/wt`.
**Checks:** both widths done; ratios computed not guessed; every finding has file:line and evidence.
**Output:** review note (PR comment draft or `K/screens/<date>-<topic>/` + note); `accessibility.md`
§4 updated if a new issue.
**Log:** `review | PR #n @ <sha> | 6 pages x 2 widths, 2 High, 1 Medium; note <link>`.
**Stop if:** build fails (hand to devops-engineer / crypto-protocol-engineer with the error; don't
review a screen you couldn't render); the screen shows real customer data or a secret (stop, `RISK:`).

## §2 Website page or section design
**Trigger:** Aashmiin or gtm-strategist asks for a new page/section or a change to an existing one.
**Inputs:** the goal (one sentence), approved copy or a copy owner, the claims it may make
(check `whitepaper/CLAIMS_AUDIT.md` on `origin/whitepaper` and `website/SOURCES.md`).
**Steps:**
1. Write the page's one job and its single primary CTA. List the claims; each must be true today.
2. Wireframe in text first: sections in order, each = Eyebrow / SectionTitle / body / visual.
3. Build with existing components (`ui.tsx`: `Eyebrow`, `SectionTitle`, `Reveal`, `PrimaryButton`,
   `SecondaryButton`, `BrowserFrame`, `Shot`) and tokens only. Visuals = real product screenshots on
   demo data (capture from the app in demo mode), labelled "demo data".
4. Run the anti-template check (`design-references.md` §4) and Gate A (honesty) before anything else.
5. Branch `design/<page>-<date>` off `origin/pitch-deck` (the website's branch), commit as Aashmiin per
   company code rules, run §1 on it, open a PR into `pitch-deck` (never `main`) with before/after at
   1280 and 390 and the checklist.
6. Say in the PR: "Not deployed. Deploy is Aashmiin's call (`bash website/deploy.sh`)."
**Stop if:** asked to add logos/testimonials/metrics that aren't real (refuse, offer the honest
alternative, `RISK:` row); copy makes a claim the code can't back (flag to qa-security-engineer).

## §3 Deck slide design
**Trigger:** new or changed slides (pitch, 10-slide, mentor brief).
**Steps:**
1. Read the build script for that deck (`pitch/src/build_*.py`) and `deck_style.py`. Change slides in
   code, not by editing the .pptx by hand.
2. One idea per slide; headline = full-sentence takeaway; ≤ ~30 words on the slide; the rest in notes
   (SAY / LABELS / sources). Honesty markers ◦ † on the slide, key in the footer.
3. Use deck tokens only (INK, CARD, LINE, WHITE, MUTED, FAINT, ACC, ACC2, RED); body ≥ 18pt; sources
   10pt FAINT on INK only (MUTED inside cards). Screenshots from `capture_shots.py` (demo data).
4. Rebuild (`pitch/README.md`), render the contact sheet, read it, then each changed slide at 100%.
5. Contrast for any new pair via `contrast.mjs`; colour never the only signal on charts.
6. PR into `pitch-deck` with the contact sheet before/after. Sending a deck to anyone is Aashmiin's.
**Stop if:** a slide needs a number with no source (mark † or remove; never invent).

## §4 White-paper layout
**Trigger:** layout, figure or template change to `whitepaper/`.
**Steps:** edit `style.tex` / `build.py` / `diagrams/` on a branch off `origin/whitepaper`; build
both copies (`python3 build.py`); read the PDF pages that changed (Read tool with `pages`); check
link colour ≥ 4.5:1 (A6), captions state the takeaway, tags render in the review copy, no orphan
headings (`needspace`), tables fit A4 width; PR with page images before/after.
**Stop if:** the toolchain (pandoc/xelatex/mmdc) isn't available: say so, change nothing you can't render.

## §5 Mind map or diagram
**Trigger:** request for a diagram (architecture, flow, state, mind map) for site, deck or paper.
**Steps:** 1) write the question it answers and the real mechanism (read the code or SPEC, not a
guess); 2) sketch nodes ≤ 7 branches, ≤ 2 levels; 3) hand-write SVG in the paper's diagram style
(`deck-and-paper-layouts.md` §3) or deck tokens for slides; 4) lines that carry meaning ≥ 3:1, text
≥ 4.5:1, red paths also dashed + labelled; 5) `<title>` + alt with the takeaway; 6) export SVG + PNG
@2x (Playwright screenshot of the SVG); 7) check at the size it will be shown (a slide at 50%, a
phone at 390).
**Stop if:** you can't confirm the mechanism from code or SPEC (draw what's confirmed; mark the rest
"to confirm").

## §6 Component or token change via PR
**Trigger:** a finding from §1/§7, or a requested component change.
**Steps:**
1. Branch `design/<topic>-<YYYYMMDD>` off the branch that owns the code (`main` for `src/`,
   `pitch-deck` for `website/`, `whitepaper` for the paper). Never commit on `main`.
2. Smallest change that fixes it (often one token). Search all uses (`rg 'var\(--text-3\)'`) and list
   them in the PR.
3. Run §1 on before and after; attach both screenshot sets and the ratio table.
4. For `src/`: run the code gates the company requires for any PR (`npx tsc --noEmit`, `npx vitest
   run`, `npx next build`) and paste the counts; if a test snapshots colours, update it in the PR and
   say so.
5. Update `brand-system.md` / `tokens.dtcg.json` / `accessibility.md` in the same PR.
6. Open the PR (body: problem, evidence, change, before/after, checklist, "Aashmiin merges"). Add a
   Product roadmap row (status `review`). Log it.
**Stop if:** asked to push directly to `main` or merge (refuse, open the PR, `RISK:` row if pressed).

## §7 Accessibility audit (a whole surface)
**Trigger:** monthly, before any public launch or investor send, or on request.
**Steps:** run §1 on every page of the surface (website: `/`, `/demo/`, `/privacy/`; product demo:
At a glance, All requests, one request per state, New request, Books, `/pay/<id>`), plus
`node K/tools/contrast.mjs` for all token pairs; manual keyboard pass of every form; record results
in `accessibility.md` §4 (date, commits, table, findings, "what I could not check"); save screenshots
under `K/screens/<surface>/`; open one PR per fix (§6), High first.
**Output:** the updated §4 and a 5-line summary (issues open by severity, change since last audit).

## §8 Weekly Thursday review (14:47 SGT, PROPOSED)
**Steps:** list commits from the last 7 days touching `website/`, `src/app`, `src/components`,
`globals.css`, `pitch/`, `whitepaper/` (`git log --since='7 days ago' --name-only origin/<branch>`);
run §1 on changed pages; re-run `contrast.mjs`; update findings; write the note to Aashmiin (email to
her only, subject `Clearline design review <YYYY-MM-DD>`): line 1 = "n screens reviewed, n meet the
checklist, a11y issues open H/M/L (±)"; then findings and the PRs waiting for her merge.
**Stop if:** nothing changed: send one line saying so (no padding).

## Stop conditions (all playbooks)
PAUSE on; request to fake logos/testimonials/numbers; request to push to `main`, merge or deploy;
real customer data or a secret in a screenshot; you can't render what you're reviewing. Stop that
task, Log with `RISK:` where risky, say what you couldn't do.
