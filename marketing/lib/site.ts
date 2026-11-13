/**
 * Single source for every outbound product link and contact detail on the website.
 *
 * PRODUCT_DEMO_URL is the ONE configurable product-demo constant. Every product link
 * (trial, software, API docs, Funding Desk) is derived from it. Override with
 * NEXT_PUBLIC_PRODUCT_DEMO_URL (must be https). Do not hard-code demo hosts elsewhere:
 * tests/content.test.mjs fails if a vercel.app URL appears outside this file.
 */
const envDemo = process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL;
export const PRODUCT_DEMO_URL: string = (envDemo && envDemo.startsWith("https://") ? envDemo : "https://clearline-customer-trial.vercel.app").replace(/\/+$/, "");

/** Guided five-case customer trial (fictional data). */
export const TRIAL_URL = PRODUCT_DEMO_URL + "/clearline/trial";
/** Connect + Control console in test mode. */
export const SOFTWARE_URL = PRODUCT_DEMO_URL + "/clearline";
/** Test-mode API reference served by the product. */
export const API_DOCS_URL = PRODUCT_DEMO_URL + "/clearline/docs";
/** Detailed Funding Desk prototype. Sandbox payments link to advances via the engine's tested projection. */
export const FUNDING_DESK_URL = PRODUCT_DEMO_URL + "/mentor-demo";

const envSite = process.env.NEXT_PUBLIC_SITE_URL;
/** Canonical site origin for metadata, sitemap and robots. */
export const SITE_URL: string = (envSite && envSite.startsWith("https://") ? envSite : "https://clearline-marketing.vercel.app").replace(/\/+$/, "");

/** Founder's verified contact email (supplied by the founder). */
export const EMAIL = "aashmiin.k.2025@accountancy.smu.edu.sg";
export const LINKEDIN = "https://www.linkedin.com/in/aashmiin-kaur-479665391";
const envBooking = process.env.NEXT_PUBLIC_BOOKING_URL;
/** Booking link is pending until the founder supplies one. */
export const BOOKING_URL: string | undefined = envBooking && envBooking.startsWith("https://") ? envBooking : undefined;

export const mailto = (subject: string) => "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject);

/** Every internal route, used by nav, sitemap and tests. */
export const ROUTES = [
  { path: "/", label: "Home" },
  { path: "/platform", label: "Platform" },
  { path: "/connect", label: "Connect" },
  { path: "/control", label: "Control" },
  { path: "/use-cases", label: "Use cases" },
  { path: "/developers", label: "Developers" },
  { path: "/trial", label: "Customer trial" },
  { path: "/onchain", label: "Onchain" },
  { path: "/about", label: "About" },
  { path: "/contact", label: "Contact" },
  { path: "/privacy", label: "Privacy" },
] as const;
