/** Small inline SVG icons (no icon package). Decorative: always next to a word or inside a labelled button. */
import type { ReactElement } from "react";

type P = { size?: number };
const svg = (path: ReactElement, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{path}</svg>
);

export const IconCheck = ({ size }: P) => svg(<path d="M3.5 8.5l3 3 6-7" />, size);
export const IconCheckDiff = ({ size }: P) => svg(<><path d="M2.5 8.5l3 3 5-6" /><path d="M11 10.5h3.5M12.75 8.75v3.5" /></>, size);
export const IconEye = ({ size }: P) => svg(<><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></>, size);
export const IconAlert = ({ size }: P) => svg(<><path d="M8 1.8l6.5 11.5h-13z" /><path d="M8 6.2v3.4M8 11.6v.1" /></>, size);
export const IconSeal = ({ size }: P) => svg(<><circle cx="8" cy="7" r="4.8" /><path d="M5.8 7.1l1.5 1.5 2.9-3" /><path d="M5.5 11.3L4.6 15l3.4-1.6 3.4 1.6-.9-3.7" /></>, size);
export const IconClock = ({ size }: P) => svg(<><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.5" /></>, size);
export const IconCircleDash = ({ size }: P) => svg(<circle cx="8" cy="8" r="5.5" strokeDasharray="2.2 2.2" />, size);
export const IconFile = ({ size }: P) => svg(<><path d="M4 1.8h5.2L12.5 5v9.2H4z" /><path d="M9 1.8V5h3.5" /></>, size);
export const IconTwoPerson = ({ size }: P) => svg(<><circle cx="5.5" cy="5.5" r="2.2" /><circle cx="11" cy="6" r="1.8" /><path d="M1.8 13.5c.4-2.6 1.8-3.8 3.7-3.8s3.3 1.2 3.7 3.8M9.6 9.6c1.9-.4 3.9.5 4.5 3.4" /></>, size);
export const IconBank = ({ size }: P) => svg(<><path d="M1.8 6L8 2.3 14.2 6z" /><path d="M3.5 6.5v5M6.5 6.5v5M9.5 6.5v5M12.5 6.5v5M1.8 13.7h12.4" /></>, size);
export const IconCopy = ({ size }: P) => svg(<><rect x="5.2" y="5.2" width="8.3" height="8.3" rx="1.5" /><path d="M10.5 5V3.8c0-.8-.6-1.3-1.3-1.3H3.8c-.8 0-1.3.5-1.3 1.3v5.4c0 .7.5 1.3 1.3 1.3H5" /></>, size);
export const IconExternal = ({ size }: P) => svg(<><path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5" /><path d="M11.5 9.5v3.2c0 .5-.4.8-.8.8H3.3c-.5 0-.8-.3-.8-.8V5.3c0-.4.3-.8.8-.8h3.2" /></>, size);
export const IconSun = ({ size }: P) => svg(<><circle cx="8" cy="8" r="3" /><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" /></>, size);
export const IconMoon = ({ size }: P) => svg(<path d="M13.3 10.2A5.8 5.8 0 0 1 5.8 2.7a5.8 5.8 0 1 0 7.5 7.5z" />, size);
export const IconSearch = ({ size }: P) => svg(<><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4l3.6 3.6" /></>, size);
export const IconRefresh = ({ size }: P) => svg(<><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3.2h-3.2" /></>, size);
export const IconSort = ({ dir, size }: P & { dir: "asc" | "desc" | "none" }) =>
  svg(dir === "asc" ? <path d="M4.5 9.5L8 6l3.5 3.5" /> : dir === "desc" ? <path d="M4.5 6.5L8 10l3.5-3.5" /> : <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />, size ?? 12);
export const IconColumns = ({ size }: P) => svg(<><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v11M10 2.5v11" /></>, size);
