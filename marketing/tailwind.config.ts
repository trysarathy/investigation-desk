import type { Config } from "tailwindcss";
/* Colours map to CSS custom properties in app/tokens.css. Do not add raw hex here. */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        midnight: "var(--cl-midnight)", blue: "var(--cl-blue)", "blue-text": "var(--cl-blue-text)", canvas: "var(--cl-canvas)",
        ice: "var(--cl-ice)", slate: "var(--cl-slate)", text: "var(--cl-text)", line: "var(--cl-line)",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
