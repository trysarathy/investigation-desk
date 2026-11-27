/**
 * v1 design-fluid: every foreground/background pair of the --cl-* tokens that the interface uses, with the minimum
 * WCAG 2.2 contrast it must meet (4.5:1 text, 3:1 UI). tests/design-tokens.test.ts recomputes each from the hex values
 * in src/app/globals.css, in both themes, and checks docs/design/TOKENS.md records the same ratios.
 */
export interface TokenPair { fg: string; bg: string; min: 4.5 | 3; use: string }

const SURFACES = ["bg", "surface", "sunk"] as const;
const STATUS = ["st-matched", "st-diff", "st-review", "st-exception", "st-approved", "st-awaiting", "ev-none", "ev-imported", "ev-two-person", "ev-bank"] as const;

export const TOKEN_PAIRS: readonly TokenPair[] = [
  ...SURFACES.flatMap((s): TokenPair[] => [
    { fg: "text", bg: s, min: 4.5, use: "body text" },
    { fg: "muted", bg: s, min: 4.5, use: "secondary text" },
    { fg: "accent", bg: s, min: 4.5, use: "links and accent text" },
    { fg: "border-strong", bg: s, min: 3, use: "input and control borders (UI)" },
    { fg: "focus", bg: s, min: 3, use: "focus outline (UI)" },
  ]),
  { fg: "on-accent", bg: "accent", min: 4.5, use: "text on an accent button" },
  { fg: "on-strong", bg: "strong", min: 4.5, use: "text on a primary button" },
  { fg: "strong", bg: "bg", min: 3, use: "primary button against the page (UI)" },
  ...STATUS.flatMap((k): TokenPair[] => [
    { fg: `${k}-fg`, bg: `${k}-bg`, min: 4.5, use: "badge word on its tint" },
    { fg: `${k}-fg`, bg: "surface", min: 4.5, use: "status text in a panel" },
    { fg: `${k}-fg`, bg: "bg", min: 4.5, use: "status text on the page" },
  ]),
];
