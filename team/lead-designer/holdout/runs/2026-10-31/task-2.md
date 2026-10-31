# T2. "I got lost in the form": design-partner form, keyboard + 390 px

lead-designer · 31 Oct 2026 (SGT) · website `origin/pitch-deck` @ `ad15acb`
**PAUSE (G19):** not checked: live tools are off in this run. Nothing deployed, pushed or sent.

## Reply to Aashmiin (plain English)

> You were right to forward it. Two real problems, both small to fix, no redesign:
> 1. **"Couldn't tell which answer they were on":** in the "How do customers pay you" question, the
>    four answer boxes show no focus at all when you move through them with the keyboard. The focus
>    goes to a hidden 1-pixel radio button, so nothing on screen moves. Everywhere else on the form
>    the blue focus ring shows; here it vanishes, which is exactly "getting lost halfway".
> 2. **"Boxes disappear into the background":** every box's outline is 1.35-1.50:1 against the card;
>    the rule for form controls is 3:1. The box fill is our ink colour on a card that is almost the
>    same colour (1.06:1), so the outline is the only thing showing where to type.
>
> Fix: give the answer boxes the same blue focus ring as the rest of the site, and draw every box
> outline in our existing "faint" grey at 70% (3.40-3.60:1). Two lines in one file. I built it and
> checked it at desktop and phone size (screenshots below). It needs your merge and, later, your
> deploy. One separate thing for you: the form's side panel says **"Free during the pilot"**, which
> contradicts the founding-pilot offer (US$300 / 30 days) in PRODUCT_FACTS. That's your call on copy;
> I haven't touched it.

## Technical detail for the PR

**Method (this run):** scratch worktree `/tmp/claude-0/ld-ho` at `ad15acb`, `website/` `npm ci` +
`next build` (static export), served from `out/` on 127.0.0.1:3400. Playwright at 1280×800 and
390×844: computed styles, keyboard pass from "Name" through Submit (Tab + Arrow keys in the radio
group), element screenshots of the form, and rendered **pixel** colours of the boundaries read from
the screenshots (Tailwind v4 mixes `/opacity` in oklab, so I measured pixels rather than assume an sRGB
composite). Ratios via `tools/contrast.mjs`.

| ID | Sev | Where | Finding | Evidence | Fix |
|---|---|---|---|---|---|
| F1 | **Medium** (2.4.7 AA fail; = A3) | `website/src/components/Partners.tsx:92-95` radio "chips" | The radio `<input>` is `sr-only`; focus lands on a **1×1 px** element (outline drawn but clipped). The `<label>` has no focus style. Arrow keys change the selection, so the selected chip moves, but which chip has focus before a choice is made is invisible | Both widths: stop 4 = `INPUT radio "Checkout page"`, box 1×1, label outline `none`. Shots `t-2/focus-radio-390.png`, `t-2/focus-radio-1280.png` (no ring anywhere) | Label: `has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`. Ring `#8ea2ff` on panel `#11141b` **7.69:1** |
| F2 | **Medium** (1.4.11 AA fail; = A4) | `Partners.tsx:13` `field` (Name, Company, Email, Select, Textarea) and chip border `:92` | Empty field identified only by its 1px border `border-line-strong` (14% white). Rendered pixels: field border `#2c2e32` vs card `#11141b` **1.35:1**, vs field fill `#0a0c11` 1.44:1; chip border `#32353b` vs card **1.50:1**. Fill vs card 1.06:1 | Pixel samples from `t-2/form-390.png` | `border-faint/70` (existing token + the opacity-modifier idiom the site already uses, e.g. `bg-panel/40`, `border-good/30`). Rendered: field `#646a77` **3.40:1** vs card, **3.60:1** vs fill; chip `#666d7a` **3.54:1** |
| F3 | Low (code hygiene) | `Partners.tsx:13` `focus:outline-none` | It does nothing today: the unlayered `:focus-visible` rule in `globals.css:48-52` beats Tailwind's layered utility, so fields do show the 2px ring (measured on all 5 fields). But the class states the opposite intent and would remove the ring if CSS layering changes | Computed outline `2px rgb(142,162,255)` on Name/Company/Email/Select/Textarea | Delete `focus:outline-none`; keep `focus:border-accent` |

**Passed, measured:** focus ring on text fields, select, textarea, checkbox, privacy link and the submit
button (2px `#8ea2ff`, offset 3px; the button's ring animates in over 150 ms because of `transition`,
settled value measured at 400 ms); selected chip = `border-accent` + `bg-accent/10` + text muted→fg
(`#eceef4` on `#1e2232` 13.61:1, not colour alone); chip text `#a3abba` on panel 7.98:1; placeholder
`faint` on ink 6.32:1; chip targets 112×68 (1280) / 146×47 (390); no horizontal scroll (390/390,
1280/1280). Consent checkbox is 16×16 but its whole label (text included) is the click target; Tab
order follows the visual order.

**Diff (2 lines; `t-2/proposed.diff`):**
```diff
-const field = "mt-2 block w-full rounded-xl border border-line-strong bg-ink px-4 py-3 text-[15px] text-fg placeholder:text-faint focus:border-accent focus:outline-none";
+const field = "mt-2 block w-full rounded-xl border border-faint/70 bg-ink px-4 py-3 text-[15px] text-fg placeholder:text-faint focus:border-accent";
-<label … className="flex cursor-pointer … rounded-xl border border-line-strong px-3 py-3 … text-muted has-[:checked]:border-accent …">
+<label … className="flex cursor-pointer … rounded-xl border border-faint/70 px-3 py-3 … text-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent has-[:checked]:border-accent …">
```
**After (built in scratch, same method):** radio chip label outline `solid` 2px accent on focus at both
widths (`t-2/after-focus-radio-390.png`, `-1280.png`); arrow-key selection still works
(`t-2/after-focus-radio-arrow-*.png`); boundaries as in F2 (`t-2/after-form-{390,1280}.png`). Look:
the boxes read as fields, still dark and quiet; no new hex, radius or component.

**WOULD OPEN PR:** branch `design/partners-form-focus-20261031` off `origin/pitch-deck` → base
`pitch-deck` (never `main`). Title "Website form: visible focus on answer chips, 3:1 field borders".
Body: problem (her note), F1-F3 table, before/after at 1280 + 390, checklist, "Not deployed. Deploy is
Aashmiin's call (`bash website/deploy.sh`)." Same PR: `accessibility.md` A3 + A4 (website half) →
fixed-pending-merge; `brand-system.md` §2 form field line updated to `border-faint/70`.
Log row drafted: `2026-10-31 | lead-designer | review+PR plan | Partners form @ ad15acb | 2 Medium, 1 Low; t-2/`.

## Checklist
G1-G5 pass (no copy changed; "Free during the pilot" flagged, not edited). G6 pass. G7 **fail before /
pass after** (1.35 → 3.40). G8 **fail before / pass after**. G9 pass. G10 pass. G11 not re-measured on
this section (site-wide 0 animations under reduced motion in the 31 Oct audit). G12 pass. G13 pass
(every field labelled, fieldset + legend). G14-G16 pass. G17 before/after attached. G18 PR plan only.
G19 not checked.

**Could not check:** a real screen magnifier (ZoomText/macOS Zoom) or screen reader; 200% zoom; 320 px;
the form's sent/error states (Formspree is not connected in a local build).
