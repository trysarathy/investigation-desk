import { loadRelease, resolveReleaseUrls } from "./release-urls.mjs";

// Product URL for this build (clearline-release.json): a Vercel preview of an rc3 release branch links to the paired
// software preview; every other build links to production. NEXT_PUBLIC_PRODUCT_DEMO_URL still overrides.
const release = resolveReleaseUrls(
  { ...process.env, CLEARLINE_PRODUCT_URL: process.env.NEXT_PUBLIC_PRODUCT_DEMO_URL || process.env.CLEARLINE_PRODUCT_URL },
  loadRelease(new URL("./clearline-release.json", import.meta.url)),
);

/** Static marketing pages; form submissions go to Formspree directly (only when configured). */
const nextConfig = {
  reactStrictMode: true, output: "export", images: { unoptimized: true }, poweredByHeader: false,
  env: { NEXT_PUBLIC_PRODUCT_DEMO_URL: release.product, NEXT_PUBLIC_CLEARLINE_RELEASE_SOURCE: release.source },
};
export default nextConfig;
