/**
 * rc6 white-label theme: a provider's display name, logo placeholder and colours, read from the provider
 * organisation's `theme` (never secrets). Pure. Every colour is validated and checked for WCAG 2.2 AA contrast before
 * it is used; a colour that would make text illegible falls back to Clearline's own ink, so a theme can never make
 * a page fail contrast.
 */
export interface SafeTheme {
  name: string;
  logoText: string;
  logoAlt: string;
  /** Header background; text on it is `onPrimary`, always with at least 4.5:1 contrast. */
  primary: string;
  onPrimary: string;
  /** Decorative stripe only (never text). */
  accent: string;
  fromProvider: boolean;
}

export const CLEARLINE_THEME: SafeTheme = { name: "Clearline", logoText: "CL", logoAlt: "Clearline", primary: "#141414", onPrimary: "#FFFFFF", accent: "#8A8273", fromProvider: false };

const HEX = /^#[0-9A-Fa-f]{6}$/;

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** WCAG 2.x contrast ratio of two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null);

export function safeTheme(raw: unknown, fallbackName?: string | null): SafeTheme {
  if (!raw || typeof raw !== "object") return fallbackName ? { ...CLEARLINE_THEME, name: fallbackName } : CLEARLINE_THEME;
  const r = raw as { name?: unknown; colours?: { primary?: unknown; accent?: unknown }; logo?: { text?: unknown; alt?: unknown } };
  const name = text(r.name, 80) ?? fallbackName ?? CLEARLINE_THEME.name;
  const primary = typeof r.colours?.primary === "string" && HEX.test(r.colours.primary) ? r.colours.primary.toUpperCase() : CLEARLINE_THEME.primary;
  const onPrimary = contrast(primary, "#FFFFFF") >= 4.5 ? "#FFFFFF" : contrast(primary, "#141414") >= 4.5 ? "#141414" : null;
  const accent = typeof r.colours?.accent === "string" && HEX.test(r.colours.accent) ? r.colours.accent.toUpperCase() : CLEARLINE_THEME.accent;
  return {
    name,
    logoText: (text(r.logo?.text, 3) ?? name.slice(0, 2)).toUpperCase(),
    logoAlt: text(r.logo?.alt, 120) ?? `${name} logo placeholder`,
    primary: onPrimary ? primary : CLEARLINE_THEME.primary,
    onPrimary: onPrimary ?? CLEARLINE_THEME.onPrimary,
    accent,
    fromProvider: true,
  };
}
