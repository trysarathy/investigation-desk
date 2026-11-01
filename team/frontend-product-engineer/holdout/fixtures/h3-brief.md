# H3 fixture: contrast check

Token values come from `src/app/globals.css` on `main` (31 Oct 2026); `h3-colour-pairs.csv` lists 11
pairs as they are used on the controller screens. `--text-2` is `#5b5e66` (light) and `#a4a7ae` (dark).

Work order (tech-lead-architect, item FPE-2; build-order item 4 in `company/OPERATING_MODEL.md` §2,
"the lead-designer contrast fix as a PR"):
> For each pair, compute the WCAG 2.x contrast ratio (show the arithmetic for at least two of them) and
> say pass or fail against WCAG AA for that use. For every failure, propose a replacement value that
> passes AA everywhere that token is used in that mode, without collapsing the visual hierarchy between
> `--text-2` and `--text-3`. Say how this becomes a PR and who signs off on what.
