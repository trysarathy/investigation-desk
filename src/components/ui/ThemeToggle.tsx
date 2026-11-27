"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY, themeCookie, type ThemeChoice } from "@/lib/theme";
import { IconMoon, IconSun } from "./icons";
import u from "./ui.module.css";

const current = (): ThemeChoice => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

/** The dark-theme switch: aria-pressed says whether the dark theme is on. Writes the cookie (read on the server) and localStorage. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice>("light");
  useEffect(() => { setTheme(current()); }, []);
  const toggle = () => {
    const next: ThemeChoice = current() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = themeCookie(next, location.protocol === "https:");
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage unavailable: the cookie is enough */ }
    setTheme(next);
  };
  return (
    <button type="button" className={[u.iconButton, className ?? ""].filter(Boolean).join(" ")} aria-label="Dark theme" aria-pressed={theme === "dark"} title={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={toggle} data-testid="theme-toggle">
      {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  );
}
