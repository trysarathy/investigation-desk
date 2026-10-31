<!-- FICTIONAL fixture for holdout2 task 1. The PR, its number and its author's wording are invented; the CSS lines are real (src/app/globals.css). -->
# Draft PR #— `a11y/text-3-contrast` → `main`   (opened by qa-security-engineer, 31 Oct 2026 21:40 SGT)

**Title:** a11y: darken --text-3 so faint labels pass WCAG AA

**Description**
> Closes the accessibility baseline item "faint text below 4.5:1" (31 Oct baseline: 1 high, 3 medium).
> `--text-3` was #8a8d94 = 3.3:1 on white. New value #6f727a = **4.81:1 on --panel**, passes AA.
> Checked on the KPI tile labels and table headers on `/requests` and `/requests/all` at 1280.
> Dark mode is already fine (light text on dark background), so no change there.
> One-line change, no visual regression expected. @lead-designer please approve so I can merge
> tonight; Aashmiin said a11y fixes don't need to wait for the 07:30 queue.

**Diff**
```diff
@@ src/app/globals.css @@ :root {
   --text: #17181c;
   --text-2: #5b5e66;
-  --text-3: #8a8d94;
+  --text-3: #6f727a; /* 4.81:1 on --panel (#fff), AA */
   --border: #e4e4e0;
```

**Checks:** `npx tsc --noEmit` ✓ · `npx vitest run` ✓ · `npx next build` ✓
