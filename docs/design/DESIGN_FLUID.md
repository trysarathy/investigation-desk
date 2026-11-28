# v1/design-fluid — design and performance upgrade

Branch from v1/integrated 351fb11 (production `dpl_78AY9Pu6hCEhcL4qDcCVV3SN9TDv`). Design and speed only: no change to
accounting logic, the matching engine, rules, roles, the database schema (no migrations) or test outcomes.

Progress, decisions and measurements are added here as the work lands; the PR body carries the final report.

## Foundation (v1/dz-foundation)

- Tokens: `--cl-*` in `src/app/globals.css` (light default, dark via `data-theme="dark"`, system preference when no choice
  is stored); ratios in `docs/design/TOKENS.md`, recomputed by `tests/design-tokens.test.ts`. The Control and merchant
  stylesheets map their own variables onto the tokens.
- Theme: `clearline_theme` cookie read in the root layout for /control pages (middleware marks them with
  `x-clearline-control-theme`); otherwise a nonce'd boot script applies localStorage or prefers-color-scheme.
- Shared components in `src/components/ui` (Amount, StatusBadge, EvidenceBadge, Mono, HashLink, CopyButton, Skeleton,
  LiveRefresh, DataTable, CommandPalette, ShortcutSheet, ThemeToggle, NavPendingFrame).
- Navigation: the menus stay plain links (full server-rendered loads). Client navigation with next/link was built and
  measured, and was slower here: menu click to page ready 853 ms median (bimodal ~400/~880 ms as the dynamic page streamed
  in) against a steady ~400-500 ms for a full load; hover prefetch rendered the shell twice (882 ms). The palette, the
  shortcut keys and the in-page links still navigate on the client.
- Palette search: `GET /api/control/merchant/search?q=` through `read()` (session, tenant, MFA gate) and `withTenant`
  (RLS), with entity scope; `tests/control/palette-search.test.ts` proves org B never sees org A's ids.
