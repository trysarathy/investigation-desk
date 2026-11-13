import type { Config } from "tailwindcss";
/* Colours map to CSS custom properties in app/tokens.css. Do not add raw hex here. */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--cl-ink)", ivory: "var(--cl-ivory)", signal: "var(--cl-signal)", "signal-strong": "var(--cl-signal-strong)",
        bluegrey: "var(--cl-bluegrey)", line: "var(--cl-line)", quiet: "var(--cl-quiet)", muted: "var(--cl-muted)",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
