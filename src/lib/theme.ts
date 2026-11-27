/**
 * v1 design-fluid: the Clearline Control theme choice. Light is the default; a stored choice (the `clearline_theme`
 * cookie, read on the server so the first paint is right, plus localStorage) wins; with no choice stored the system
 * preference (prefers-color-scheme) applies. Nothing is stored in the database.
 */
export type ThemeChoice = "light" | "dark";
export const THEME_COOKIE = "clearline_theme";
export const THEME_STORAGE_KEY = "clearline.theme";
/** One year. */
export const THEME_COOKIE_MAX_AGE = 31_536_000;

export const parseTheme = (v: string | null | undefined): ThemeChoice | null => (v === "light" || v === "dark" ? v : null);

/**
 * The inline script (run before first paint, with the request's CSP nonce) for a page whose cookie held no choice:
 * a choice kept in localStorage, else the system preference. It only ever sets data-theme on <html>.
 */
export const THEME_BOOT_SCRIPT =
  `(function(){try{var d=document.documentElement;if(d.hasAttribute("data-theme"))return;var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
  `if(t!=="light"&&t!=="dark")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.setAttribute("data-theme",t)}catch(e){}})();`;

/** The cookie string the toggle writes (Secure on https). */
export const themeCookie = (t: ThemeChoice, secure: boolean) =>
  `${THEME_COOKIE}=${t}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
