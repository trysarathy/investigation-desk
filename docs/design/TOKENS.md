# Clearline design tokens

v1 design-fluid. One set of CSS custom properties (`--cl-*`) in `src/app/globals.css` drives Clearline Control and the
merchant workspace in both themes. Light is the default. Dark applies through `data-theme="dark"` on `<html>` (the
`clearline_theme` cookie, read on the server) or, when nothing is stored, through `prefers-color-scheme`.

The Control (`control.module.css`) and merchant (`merchant.module.css`) stylesheets keep their own variable names
(`--paper`, `--ink`, `--muted`, `--green`, `--oxblood`, `--info`, `--amber`…), and each now points at a token, so every
existing page follows the theme. The provider's brand bar keeps the provider's colours (checked by `safeTheme`).

Ratios are WCAG 2.x contrast, computed from these hex values. `tests/design-tokens.test.ts` recomputes every row,
fails below 4.5:1 for text or 3:1 for UI, and fails if this table drifts from the CSS. `--cl-border` (hairline) is a
decorative divider, never the only boundary of a control, so it has no minimum.

## Tokens

| Token | Light | Dark |
|---|---|---|
| `--cl-bg` | #f6f7f9 | #0e1014 |
| `--cl-surface` | #ffffff | #15181e |
| `--cl-sunk` | #eef0f3 | #1b1f27 |
| `--cl-text` | #16181d | #e7e9ee |
| `--cl-muted` | #555b66 | #a2a8b4 |
| `--cl-border` | #e1e4e9 | #2a2f39 |
| `--cl-border-strong` | #848a95 | #6c7381 |
| `--cl-focus` | #2b56d1 | #8db1ff |
| `--cl-accent` | #2b53c6 | #86a3ff |
| `--cl-on-accent` | #ffffff | #0b1020 |
| `--cl-strong` | #16181d | #e7e9ee |
| `--cl-on-strong` | #ffffff | #111318 |
| `--cl-st-matched-fg` | #1b6a43 | #6fd39c |
| `--cl-st-matched-bg` | #e5f3ea | #0f271b |
| `--cl-st-diff-fg` | #0c5c70 | #6cc8de |
| `--cl-st-diff-bg` | #e1f1f6 | #0c2630 |
| `--cl-st-review-fg` | #774b00 | #f0c066 |
| `--cl-st-review-bg` | #fbefd5 | #2b2210 |
| `--cl-st-exception-fg` | #9a1b1b | #ff958c |
| `--cl-st-exception-bg` | #fae8e8 | #33161a |
| `--cl-st-approved-fg` | #4535a6 | #b7abff |
| `--cl-st-approved-bg` | #ece9fa | #201b3c |
| `--cl-st-awaiting-fg` | #4a5260 | #b6bdc9 |
| `--cl-st-awaiting-bg` | #eceef2 | #1e232c |
| `--cl-ev-none-fg` | #4a5260 | #b6bdc9 |
| `--cl-ev-none-bg` | #eceef2 | #1e232c |
| `--cl-ev-imported-fg` | #1d4c78 | #90bff2 |
| `--cl-ev-imported-bg` | #e5eef7 | #0f2239 |
| `--cl-ev-two-person-fg` | #13615a | #70d6c7 |
| `--cl-ev-two-person-bg` | #e1f2ef | #0c2926 |
| `--cl-ev-bank-fg` | #4535a6 | #b7abff |
| `--cl-ev-bank-bg` | #ece9fa | #201b3c |

Non-colour tokens: `--cl-font-ui` (Inter 400/500/600), `--cl-font-mono` (JetBrains Mono 400/500), `--cl-dur` 150 ms,
`--cl-dur-fast` 100 ms, `--cl-dur-slow` 200 ms, `--cl-ease`, `--cl-row-h` 32 px, `--cl-radius` 6 px, `--cl-shadow`.
Under `prefers-reduced-motion: reduce` every transition and animation is switched off.

Status tokens: `st-matched` (Matched), `st-diff` (Matched with difference), `st-review` (Needs review), `st-exception`
(Exception), `st-approved` (Approved), `st-awaiting` (Awaiting evidence). Evidence: `ev-none`, `ev-imported`,
`ev-two-person` (imported, second-person confirmed), `ev-bank` (bank-authenticated, reserved). Each badge also has its
own icon and word, so colour is never the only signal.

## Contrast pairs

| Theme | Foreground | Background | Ratio | Minimum | Use |
|---|---|---|---|---|---|
| light | `--cl-text` #16181d | `--cl-bg` #f6f7f9 | 16.57:1 | 4.5:1 | body text |
| light | `--cl-muted` #555b66 | `--cl-bg` #f6f7f9 | 6.37:1 | 4.5:1 | secondary text |
| light | `--cl-accent` #2b53c6 | `--cl-bg` #f6f7f9 | 6.21:1 | 4.5:1 | links and accent text |
| light | `--cl-border-strong` #848a95 | `--cl-bg` #f6f7f9 | 3.24:1 | 3:1 | input and control borders (UI) |
| light | `--cl-focus` #2b56d1 | `--cl-bg` #f6f7f9 | 5.84:1 | 3:1 | focus outline (UI) |
| light | `--cl-text` #16181d | `--cl-surface` #ffffff | 17.76:1 | 4.5:1 | body text |
| light | `--cl-muted` #555b66 | `--cl-surface` #ffffff | 6.83:1 | 4.5:1 | secondary text |
| light | `--cl-accent` #2b53c6 | `--cl-surface` #ffffff | 6.66:1 | 4.5:1 | links and accent text |
| light | `--cl-border-strong` #848a95 | `--cl-surface` #ffffff | 3.47:1 | 3:1 | input and control borders (UI) |
| light | `--cl-focus` #2b56d1 | `--cl-surface` #ffffff | 6.26:1 | 3:1 | focus outline (UI) |
| light | `--cl-text` #16181d | `--cl-sunk` #eef0f3 | 15.55:1 | 4.5:1 | body text |
| light | `--cl-muted` #555b66 | `--cl-sunk` #eef0f3 | 5.98:1 | 4.5:1 | secondary text |
| light | `--cl-accent` #2b53c6 | `--cl-sunk` #eef0f3 | 5.83:1 | 4.5:1 | links and accent text |
| light | `--cl-border-strong` #848a95 | `--cl-sunk` #eef0f3 | 3.04:1 | 3:1 | input and control borders (UI) |
| light | `--cl-focus` #2b56d1 | `--cl-sunk` #eef0f3 | 5.48:1 | 3:1 | focus outline (UI) |
| light | `--cl-on-accent` #ffffff | `--cl-accent` #2b53c6 | 6.66:1 | 4.5:1 | text on an accent button |
| light | `--cl-on-strong` #ffffff | `--cl-strong` #16181d | 17.76:1 | 4.5:1 | text on a primary button |
| light | `--cl-strong` #16181d | `--cl-bg` #f6f7f9 | 16.57:1 | 3:1 | primary button against the page (UI) |
| light | `--cl-st-matched-fg` #1b6a43 | `--cl-st-matched-bg` #e5f3ea | 5.75:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-matched-fg` #1b6a43 | `--cl-surface` #ffffff | 6.58:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-matched-fg` #1b6a43 | `--cl-bg` #f6f7f9 | 6.14:1 | 4.5:1 | status text on the page |
| light | `--cl-st-diff-fg` #0c5c70 | `--cl-st-diff-bg` #e1f1f6 | 6.51:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-diff-fg` #0c5c70 | `--cl-surface` #ffffff | 7.55:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-diff-fg` #0c5c70 | `--cl-bg` #f6f7f9 | 7.05:1 | 4.5:1 | status text on the page |
| light | `--cl-st-review-fg` #774b00 | `--cl-st-review-bg` #fbefd5 | 6.60:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-review-fg` #774b00 | `--cl-surface` #ffffff | 7.52:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-review-fg` #774b00 | `--cl-bg` #f6f7f9 | 7.02:1 | 4.5:1 | status text on the page |
| light | `--cl-st-exception-fg` #9a1b1b | `--cl-st-exception-bg` #fae8e8 | 6.98:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-exception-fg` #9a1b1b | `--cl-surface` #ffffff | 8.25:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-exception-fg` #9a1b1b | `--cl-bg` #f6f7f9 | 7.69:1 | 4.5:1 | status text on the page |
| light | `--cl-st-approved-fg` #4535a6 | `--cl-st-approved-bg` #ece9fa | 7.61:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-approved-fg` #4535a6 | `--cl-surface` #ffffff | 9.08:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-approved-fg` #4535a6 | `--cl-bg` #f6f7f9 | 8.47:1 | 4.5:1 | status text on the page |
| light | `--cl-st-awaiting-fg` #4a5260 | `--cl-st-awaiting-bg` #eceef2 | 6.78:1 | 4.5:1 | badge word on its tint |
| light | `--cl-st-awaiting-fg` #4a5260 | `--cl-surface` #ffffff | 7.87:1 | 4.5:1 | status text in a panel |
| light | `--cl-st-awaiting-fg` #4a5260 | `--cl-bg` #f6f7f9 | 7.35:1 | 4.5:1 | status text on the page |
| light | `--cl-ev-none-fg` #4a5260 | `--cl-ev-none-bg` #eceef2 | 6.78:1 | 4.5:1 | badge word on its tint |
| light | `--cl-ev-none-fg` #4a5260 | `--cl-surface` #ffffff | 7.87:1 | 4.5:1 | status text in a panel |
| light | `--cl-ev-none-fg` #4a5260 | `--cl-bg` #f6f7f9 | 7.35:1 | 4.5:1 | status text on the page |
| light | `--cl-ev-imported-fg` #1d4c78 | `--cl-ev-imported-bg` #e5eef7 | 7.60:1 | 4.5:1 | badge word on its tint |
| light | `--cl-ev-imported-fg` #1d4c78 | `--cl-surface` #ffffff | 8.91:1 | 4.5:1 | status text in a panel |
| light | `--cl-ev-imported-fg` #1d4c78 | `--cl-bg` #f6f7f9 | 8.31:1 | 4.5:1 | status text on the page |
| light | `--cl-ev-two-person-fg` #13615a | `--cl-ev-two-person-bg` #e1f2ef | 6.29:1 | 4.5:1 | badge word on its tint |
| light | `--cl-ev-two-person-fg` #13615a | `--cl-surface` #ffffff | 7.28:1 | 4.5:1 | status text in a panel |
| light | `--cl-ev-two-person-fg` #13615a | `--cl-bg` #f6f7f9 | 6.79:1 | 4.5:1 | status text on the page |
| light | `--cl-ev-bank-fg` #4535a6 | `--cl-ev-bank-bg` #ece9fa | 7.61:1 | 4.5:1 | badge word on its tint |
| light | `--cl-ev-bank-fg` #4535a6 | `--cl-surface` #ffffff | 9.08:1 | 4.5:1 | status text in a panel |
| light | `--cl-ev-bank-fg` #4535a6 | `--cl-bg` #f6f7f9 | 8.47:1 | 4.5:1 | status text on the page |
| dark | `--cl-text` #e7e9ee | `--cl-bg` #0e1014 | 15.68:1 | 4.5:1 | body text |
| dark | `--cl-muted` #a2a8b4 | `--cl-bg` #0e1014 | 7.98:1 | 4.5:1 | secondary text |
| dark | `--cl-accent` #86a3ff | `--cl-bg` #0e1014 | 7.89:1 | 4.5:1 | links and accent text |
| dark | `--cl-border-strong` #6c7381 | `--cl-bg` #0e1014 | 4.00:1 | 3:1 | input and control borders (UI) |
| dark | `--cl-focus` #8db1ff | `--cl-bg` #0e1014 | 8.95:1 | 3:1 | focus outline (UI) |
| dark | `--cl-text` #e7e9ee | `--cl-surface` #15181e | 14.63:1 | 4.5:1 | body text |
| dark | `--cl-muted` #a2a8b4 | `--cl-surface` #15181e | 7.45:1 | 4.5:1 | secondary text |
| dark | `--cl-accent` #86a3ff | `--cl-surface` #15181e | 7.36:1 | 4.5:1 | links and accent text |
| dark | `--cl-border-strong` #6c7381 | `--cl-surface` #15181e | 3.73:1 | 3:1 | input and control borders (UI) |
| dark | `--cl-focus` #8db1ff | `--cl-surface` #15181e | 8.35:1 | 3:1 | focus outline (UI) |
| dark | `--cl-text` #e7e9ee | `--cl-sunk` #1b1f27 | 13.59:1 | 4.5:1 | body text |
| dark | `--cl-muted` #a2a8b4 | `--cl-sunk` #1b1f27 | 6.92:1 | 4.5:1 | secondary text |
| dark | `--cl-accent` #86a3ff | `--cl-sunk` #1b1f27 | 6.84:1 | 4.5:1 | links and accent text |
| dark | `--cl-border-strong` #6c7381 | `--cl-sunk` #1b1f27 | 3.46:1 | 3:1 | input and control borders (UI) |
| dark | `--cl-focus` #8db1ff | `--cl-sunk` #1b1f27 | 7.76:1 | 3:1 | focus outline (UI) |
| dark | `--cl-on-accent` #0b1020 | `--cl-accent` #86a3ff | 7.84:1 | 4.5:1 | text on an accent button |
| dark | `--cl-on-strong` #111318 | `--cl-strong` #e7e9ee | 15.30:1 | 4.5:1 | text on a primary button |
| dark | `--cl-strong` #e7e9ee | `--cl-bg` #0e1014 | 15.68:1 | 3:1 | primary button against the page (UI) |
| dark | `--cl-st-matched-fg` #6fd39c | `--cl-st-matched-bg` #0f271b | 8.65:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-matched-fg` #6fd39c | `--cl-surface` #15181e | 9.71:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-matched-fg` #6fd39c | `--cl-bg` #0e1014 | 10.40:1 | 4.5:1 | status text on the page |
| dark | `--cl-st-diff-fg` #6cc8de | `--cl-st-diff-bg` #0c2630 | 8.20:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-diff-fg` #6cc8de | `--cl-surface` #15181e | 9.27:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-diff-fg` #6cc8de | `--cl-bg` #0e1014 | 9.93:1 | 4.5:1 | status text on the page |
| dark | `--cl-st-review-fg` #f0c066 | `--cl-st-review-bg` #2b2210 | 9.29:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-review-fg` #f0c066 | `--cl-surface` #15181e | 10.53:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-review-fg` #f0c066 | `--cl-bg` #0e1014 | 11.28:1 | 4.5:1 | status text on the page |
| dark | `--cl-st-exception-fg` #ff958c | `--cl-st-exception-bg` #33161a | 7.82:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-exception-fg` #ff958c | `--cl-surface` #15181e | 8.41:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-exception-fg` #ff958c | `--cl-bg` #0e1014 | 9.00:1 | 4.5:1 | status text on the page |
| dark | `--cl-st-approved-fg` #b7abff | `--cl-st-approved-bg` #201b3c | 8.01:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-approved-fg` #b7abff | `--cl-surface` #15181e | 8.70:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-approved-fg` #b7abff | `--cl-bg` #0e1014 | 9.32:1 | 4.5:1 | status text on the page |
| dark | `--cl-st-awaiting-fg` #b6bdc9 | `--cl-st-awaiting-bg` #1e232c | 8.34:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-st-awaiting-fg` #b6bdc9 | `--cl-surface` #15181e | 9.41:1 | 4.5:1 | status text in a panel |
| dark | `--cl-st-awaiting-fg` #b6bdc9 | `--cl-bg` #0e1014 | 10.07:1 | 4.5:1 | status text on the page |
| dark | `--cl-ev-none-fg` #b6bdc9 | `--cl-ev-none-bg` #1e232c | 8.34:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-ev-none-fg` #b6bdc9 | `--cl-surface` #15181e | 9.41:1 | 4.5:1 | status text in a panel |
| dark | `--cl-ev-none-fg` #b6bdc9 | `--cl-bg` #0e1014 | 10.07:1 | 4.5:1 | status text on the page |
| dark | `--cl-ev-imported-fg` #90bff2 | `--cl-ev-imported-bg` #0f2239 | 8.35:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-ev-imported-fg` #90bff2 | `--cl-surface` #15181e | 9.24:1 | 4.5:1 | status text in a panel |
| dark | `--cl-ev-imported-fg` #90bff2 | `--cl-bg` #0e1014 | 9.90:1 | 4.5:1 | status text on the page |
| dark | `--cl-ev-two-person-fg` #70d6c7 | `--cl-ev-two-person-bg` #0c2926 | 8.92:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-ev-two-person-fg` #70d6c7 | `--cl-surface` #15181e | 10.27:1 | 4.5:1 | status text in a panel |
| dark | `--cl-ev-two-person-fg` #70d6c7 | `--cl-bg` #0e1014 | 11.00:1 | 4.5:1 | status text on the page |
| dark | `--cl-ev-bank-fg` #b7abff | `--cl-ev-bank-bg` #201b3c | 8.01:1 | 4.5:1 | badge word on its tint |
| dark | `--cl-ev-bank-fg` #b7abff | `--cl-surface` #15181e | 8.70:1 | 4.5:1 | status text in a panel |
| dark | `--cl-ev-bank-fg` #b7abff | `--cl-bg` #0e1014 | 9.32:1 | 4.5:1 | status text on the page |
