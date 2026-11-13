// Security headers for every route (QA L2).
// R2 (rc3): every page passes through src/middleware.ts, which REPLACES this Content-Security-Policy with a
// per-request nonce policy (script-src 'self' 'nonce-…' 'strict-dynamic', no 'unsafe-inline'). This static
// policy is the fallback for responses the middleware does not produce: the test API (excluded from the
// matcher for QA L3), static files, and the middleware's own 401/404/redirect answers. None of them needs
// an inline script, so the fallback has no 'unsafe-inline' either: a page that ever missed the middleware
// would fail closed (its inline scripts blocked), not open. Directives other than script-src match the
// nonce policy (tests/platform checks this). Dev mode additionally needs 'unsafe-eval' for React Refresh.
const isDev = process.env.NODE_ENV !== 'production';
export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
export const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

import { loadRelease, resolveReleaseUrls } from './release-urls.mjs';

const ON = (v) => v === undefined || v === '' ? false : v;
// DEMO_MODE values that switch the legacy desk to live mode (src/lib/mode.ts isDemoMode()).
const LIVE_DEMO_MODE = /^(off|0|false|no|live)$/i;

/**
 * Fail fast on a deployment configuration that would silently do something other than intended
 * (Task 3, rc3). Reads only variables the app already reads; never prints a secret's value.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} problems, empty when the configuration is valid
 */
export function deploymentConfigProblems(env) {
  const problems = [];
  const preview = ON(env.CLEARLINE_CUSTOMER_PREVIEW);
  const fundingOnly = ON(env.CLEARLINE_FUNDING_ONLY);
  // src/middleware.ts and the layouts test `=== "1"`: any other value silently turns the mode OFF.
  if (preview && preview !== '1') problems.push(`CLEARLINE_CUSTOMER_PREVIEW is ${JSON.stringify(preview)}; only "1" turns the customer-preview allow-list on. Use "1", or unset it for the full app.`);
  if (fundingOnly && fundingOnly !== '1') problems.push(`CLEARLINE_FUNDING_ONLY is ${JSON.stringify(fundingOnly)}; only "1" turns funding-only mode on. Use "1", or unset it.`);
  if (preview === '1' && fundingOnly === '1') problems.push('CLEARLINE_CUSTOMER_PREVIEW and CLEARLINE_FUNDING_ONLY are both "1"; they are separate deployments. Set only one.');
  const user = ON(env.PREVIEW_USER);
  const password = ON(env.PREVIEW_PASSWORD);
  if (!!user !== !!password) problems.push(`Only ${user ? 'PREVIEW_USER' : 'PREVIEW_PASSWORD'} is set; the preview password gate needs both, and with one alone nothing is protected.`);
  if (password && password.length < 12) problems.push('PREVIEW_PASSWORD is shorter than 12 characters.');
  if ((user || password) && (preview === '1' || fundingOnly === '1')) problems.push(`PREVIEW_USER/PREVIEW_PASSWORD are set, but ${preview === '1' ? 'CLEARLINE_CUSTOMER_PREVIEW' : 'CLEARLINE_FUNDING_ONLY'}=1 bypasses the password gate (src/middleware.ts), so they protect nothing. Unset them, or unset the mode.`);
  // Live execution: QuickBooks posting goes to the production company only with QBO_ENV=production
  // (src/lib/accounting/providers/quickbooks.ts); the adapter is untested and QuickBooks is not offered.
  if (env.QBO_ENV === 'production') problems.push('QBO_ENV=production would post to a live QuickBooks company; QuickBooks is not offered and its adapter is untested. Unset QBO_ENV (sandbox).');
  // The customer preview is fictional-only: it must not run in live mode or hold accounting write credentials.
  if (preview === '1') {
    if (env.DEMO_MODE !== undefined && LIVE_DEMO_MODE.test(env.DEMO_MODE.trim())) problems.push(`DEMO_MODE=${JSON.stringify(env.DEMO_MODE)} switches to live mode; the customer preview is fictional-only. Unset DEMO_MODE.`);
    const creds = ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET', 'QBO_ACCESS_TOKEN', 'QBO_REALM_ID'].filter((k) => ON(env[k]));
    if (creds.length) problems.push(`${creds.join(', ')} ${creds.length > 1 ? 'are' : 'is'} set; the customer preview is fictional-only and must not hold accounting write credentials. Remove them from this deployment.`);
  }
  return problems;
}

/** Throws one error listing every problem. Runs whenever Next loads this file: `next build`, `next start`, `next dev`. */
export function assertDeploymentConfig(env) {
  const problems = deploymentConfigProblems(env);
  if (problems.length) throw new Error(`Invalid Clearline deployment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSee docs/release/SECURITY_PLATFORM_RC3.md.`);
}
assertDeploymentConfig(process.env);

/**
 * QA L3 (rc3): bytes of a request body Next copies for the middleware (and drains past). The legacy
 * investigation-desk uploads need the 20 MB file plus its form (REQUEST_MAX_BYTES in src/lib/limits.ts;
 * a test checks they match). A customer-preview deployment 404s every upload route and nothing it
 * allows through the middleware reads a body (no server actions; the test API is outside the matcher),
 * so there the copy is capped at 64 KB and a large POST to a page costs at most that.
 */
export const PREVIEW_MIDDLEWARE_BODY_MAX = 64 * 1024;
export function middlewareBodyLimit(env) {
  return env.CLEARLINE_CUSTOMER_PREVIEW === '1' ? PREVIEW_MIDDLEWARE_BODY_MAX : 21 * 1024 * 1024;
}

// Website/software URLs for this build (clearline-release.json); inlined into client and server code.
const releaseUrls = resolveReleaseUrls(process.env, loadRelease(new URL('./clearline-release.json', import.meta.url)));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_CLEARLINE_PRODUCT_URL: releaseUrls.product,
    NEXT_PUBLIC_CLEARLINE_MARKETING_URL: releaseUrls.marketing,
    NEXT_PUBLIC_CLEARLINE_FUNDING_DESK_URL: releaseUrls.fundingDesk,
    NEXT_PUBLIC_CLEARLINE_RELEASE_SOURCE: releaseUrls.source,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  webpack(config) {
    // Existing CLI modules use Node-style .js specifiers for TypeScript sources.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    // YAML files are bundled as plain strings at build time (e.g. the OpenAPI document served at
    // /clearline/docs/openapi.yaml), so no route reads the filesystem at runtime.
    config.module.rules.push({ test: /\.ya?ml$/, type: 'asset/source' });
    return config;
  },
  experimental: {
    // Request bodies pass through the middleware, which by default keeps only the first 10 MB:
    // a larger upload reached the route cut short. This matches REQUEST_MAX_BYTES in
    // src/lib/limits.ts (the 20 MB file limit plus the form around it); a test checks they match.
    // In a customer-preview deployment it is 64 KB (see middlewareBodyLimit above).
    middlewareClientMaxBodySize: middlewareBodyLimit(process.env),
  },
};
export default nextConfig;
